import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { confidenceFlagsProvider, confidenceExpProvider, registerConfidenceClient } from "../src/server/confidence.js";

const scopes = ["openid", "profile", "email", "offline_access"];
const context = { applicationId: "assistant", subjectId: "owner" };
const input = { context, integrationId: "research" };
const callback = "http://127.0.0.1:4930/confidence/callback";
const origin = "https://mcp.confidence.dev";
const specs = [
  { provider: confidenceFlagsProvider, path: "flags", name: "getFlag", arguments: { name: "flags/approved-flag" } },
  { provider: confidenceExpProvider, path: "experiments", name: "get_experiment", arguments: { name: "workflows/abtest/instances/approved" } }
];
async function fixture(t, spec) {
  const directory = await mkdtemp(path.join(tmpdir(), "confidence-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const state = { time: Date.now(), scopes, status: 200,
    list: { tools: [{ name: spec.name, inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } }] },
    call: { content: [{ type: "text", text: "Fixture resource" }] } };
  const options = {
    configuration: { schemaVersion: 1, registrations: { confidence: { source: "own", clientId: "client", clientSecretRef: "env:CONFIDENCE_SECRET", callbackUrlRef: "env:CONFIDENCE_CALLBACK" } },
      integrations: { research: { provider: spec.provider.id, accountMode: "assistant", scopes, authentication: { method: "oauth2", registrationRef: "confidence" } } } },
    providers: specs.map((item) => item.provider), now: () => state.time,
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" }) }),
    authorize: async (owner, request) => request.operation === "tools.call" && (request.input.name !== spec.name || request.input.arguments.name !== spec.arguments.name) ? null : owner,
    resolveReference: async (reference) => reference === "env:CONFIDENCE_SECRET" ? "private-client-secret" : callback,
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted(); const url = String(address); requests.push({ url, init, headers: new Headers(init.headers) });
      if (url === `${origin}/token`) {
        if (state.tokenError) return Response.json({ error: state.tokenError, error_description: "private-client-secret" }, { status: 400 });
        const refresh = new URLSearchParams(init.body).get("grant_type") === "refresh_token";
        return Response.json({ token_type: "Bearer", access_token: refresh ? "access-two" : "access-one", refresh_token: refresh ? "refresh-two" : "refresh-one", expires_in: 60, scope: state.scopes.join(" ") });
      }
      assert.equal(url, `${origin}/mcp/${spec.path}`);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (state.status !== 200) return new Response("private-client-secret access-one", { status: state.status,
        headers: { "WWW-Authenticate": 'Bearer resource_metadata="http://mcp.confidence.dev/.well-known/oauth-protected-resource/mcp"' } });
      const message = JSON.parse(init.body); requests.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (state.pause && message.method === "tools/call") {
        state.started(); return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "confidence-fixture", version: "1" } }
        : message.method === "tools/list" ? state.list : state.call;
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "Mcp-Session-Id": "fixture-session" } });
    }
  };
  const service = createConnectionService(options);
  const complete = (start, extra = "code=fixture-code") => service.completeAuthorization({ ...input, callbackUrl: `${callback}?state=${new URL(start.authorizationUrl).searchParams.get("state")}&${extra}` });
  return { service, options, state, requests, directory, complete };
}

for (const spec of specs) {
  test(`${spec.provider.name} binds PKCE to the declared common resource and preserves encrypted grants across refresh and restart`, async (t) => {
    const f = await fixture(t, spec); const start = await f.service.beginAuthorization(input); const url = new URL(start.authorizationUrl);
    assert.equal(url.origin + url.pathname, `${origin}/authorize`); assert.equal(url.searchParams.get("resource"), `${origin}/mcp`);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256"); assert.equal(url.searchParams.get("scope"), scopes.join(" "));
    assert.equal((await f.complete(start)).status, "connected");
    const body = new URLSearchParams(f.requests.find((request) => request.url.endsWith("/token")).init.body);
    assert.equal(body.get("resource"), `${origin}/mcp`); assert.equal(body.get("client_secret"), "private-client-secret"); assert.equal(body.get("redirect_uri"), callback); assert(body.get("code_verifier"));
    assert.equal(f.requests.some(({ message }) => message?.method === "tools/call"), false);
    const restarted = createConnectionService(f.options); f.state.time += 61_000;
    f.state.list = { tools: [], nextCursor: "next-page" };
    assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: { cursor: "next-page" } }), f.state.list);
    assert.deepEqual(f.requests.findLast(({ message }) => message?.method === "tools/list").message.params, { cursor: "next-page" });
    const refresh = new URLSearchParams(f.requests.findLast(({ url }) => url.endsWith("/token")).init.body);
    assert.equal(refresh.get("resource"), `${origin}/mcp`); assert.equal(refresh.get("refresh_token"), "refresh-one");
    assert.equal(f.requests.at(-1).headers.get("authorization"), "Bearer access-two");
    for (const request of f.requests.filter(({ url }) => url.includes("/mcp/"))) { assert.equal(request.init.redirect, "error"); assert.equal(request.init.credentials, "omit"); }
    for (const file of await readdir(f.directory)) for (const secret of ["private-client-secret", "access-one", "access-two", "refresh-one", "refresh-two", body.get("code_verifier")]) assert(!(await readFile(path.join(f.directory, file), "utf8")).includes(secret));
    const count = f.requests.length;
    await assert.rejects(f.complete(start), { code: "connector_attempt_invalid" });
    for (const owner of [{ ...context, applicationId: "other" }, { ...context, subjectId: "other" }]) await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "tools.list" }), { code: "connector_reconnect_required" });
    await restarted.disconnect(input); assert.equal((await f.service.status(input)).status, "disconnected"); assert.equal(f.requests.length, count);
  });

  test(`${spec.provider.name} authorizes exact tool resources, preserves errors and cancels without replay`, async (t) => {
    const f = await fixture(t, spec); await f.complete(await f.service.beginAuthorization(input)); const before = f.requests.length;
    for (const call of [{ name: "deleteEverything", arguments: {} }, { name: spec.name, arguments: { name: "another-owner-resource" } }]) await assert.rejects(f.service.invoke({ ...input, operation: "tools.call", input: call }), { code: "connector_access_denied" });
    await assert.rejects(f.service.invoke({ ...input, operation: "tools.list", input: { url: "https://invalid.test" } }), { code: "connector_input_invalid" });
    assert.equal(f.requests.length, before);
    const call = { name: spec.name, arguments: spec.arguments }; f.state.call = { content: [{ type: "text", text: "Fixture tool failure" }], isError: true };
    assert.deepEqual(await f.service.invoke({ ...input, operation: "tools.call", input: call }), f.state.call);
    assert.deepEqual(f.requests.findLast(({ message }) => message?.method === "tools/call").message.params, call);
    f.state.pause = true; const started = new Promise((resolve) => { f.state.started = resolve; }); const controller = new AbortController();
    const pending = assert.rejects(f.service.invoke({ ...input, operation: "tools.call", input: call, signal: controller.signal }), { code: "connector_cancelled" });
    await started; controller.abort(); await pending;
    assert.equal(f.requests.filter(({ message }) => message?.method === "tools/call").length, 2); assert.equal(f.requests.at(-1).init.method, "DELETE");
  });

  test(`${spec.provider.name} rejects declined or reduced consent and redacts transport errors without HTTP discovery`, async (t) => {
    const f = await fixture(t, spec);
    await assert.rejects(f.complete(await f.service.beginAuthorization(input), "error=access_denied"), { code: "connector_consent_denied" }); assert.equal(f.requests.length, 0);
    f.state.scopes = ["profile"]; await assert.rejects(f.complete(await f.service.beginAuthorization(input)), { code: "connector_scope_missing" });
    f.state.scopes = scopes; f.state.list = { wrong: [] }; await assert.rejects(f.complete(await f.service.beginAuthorization(input)), { code: "connector_provider_failed" });
    f.state.list = { tools: [] };
    for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
      f.state.status = status;
      await assert.rejects(f.complete(await f.service.beginAuthorization(input)), (error) => error.code === code && error.cause === undefined && !error.message.includes("private-client-secret"));
    }
    assert(f.requests.every(({ url }) => url === `${origin}/token` || url === `${origin}/mcp/${spec.path}`));
    f.state.status = 200; await f.complete(await f.service.beginAuthorization(input)); f.state.time += 61_000; f.state.tokenError = "invalid_grant";
    await assert.rejects(f.service.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
    assert.equal((await f.service.status(input)).status, "reconnect-required");
  });
}

test("Confidence Flags and Experiments cannot reuse a pending attempt or connected grant by changing provider", async (t) => {
  const f = await fixture(t, specs[0]); const start = await f.service.beginAuthorization(input);
  const config = structuredClone(f.options.configuration); config.integrations.research.provider = confidenceExpProvider.id;
  const changed = createConnectionService({ ...f.options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: `${callback}?code=x&state=${new URL(start.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
  assert.equal(f.requests.length, 0); await f.complete(await f.service.beginAuthorization(input)); const before = f.requests.length;
  assert.equal((await changed.status(input)).status, "reconnect-required");
  await assert.rejects(changed.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" }); assert.equal(f.requests.length, before);
});

test("Confidence registration uses confidential client metadata and exact application-owned HTTPS callbacks", async () => {
  for (const spec of specs) {
    const callbackUrl = `https://application.example/integrations/${spec.provider.id}/callback`; const requests = [];
    const result = await registerConfidenceClient({ clientName: spec.provider.name, callbackUrl, scopes }, { fetchImpl: async (url, init) => {
      requests.push({ url, init }); return Response.json({ ...JSON.parse(init.body), client_id: "created-client", client_secret: "created-secret", client_secret_expires_at: 0 });
    } });
    assert.deepEqual(result, { clientId: "created-client", clientSecret: "created-secret", clientSecretExpiresAt: 0 }); assert.equal(requests.length, 1);
    assert.equal(String(requests[0].url), `${origin}/register`); assert.equal(requests[0].init.redirect, "error"); assert.equal(requests[0].init.credentials, "omit");
    assert.deepEqual(JSON.parse(requests[0].init.body), { client_name: spec.provider.name, redirect_uris: [callbackUrl], token_endpoint_auth_method: "client_secret_post", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: scopes.join(" ") });
  }
});

test("Confidence registration rejects invalid or ambiguous responses and interruption without repeat creation", async () => {
  const valid = { clientName: "Assistant", callbackUrl: callback, scopes }; let requests = 0;
  const options = { fetchImpl: async () => { requests++; throw Error("private response"); } };
  for (const change of [{ scopes: ["flags:read"] }, { scopes: ["openid", "openid"] }, { callbackUrl: "http://remote.test/callback" }, { callbackUrl: "https://user:pass@host.test/callback" }, { clientName: "" }]) await assert.rejects(registerConfidenceClient({ ...valid, ...change }, options));
  assert.equal(requests, 0); await assert.rejects(registerConfidenceClient(valid, options), { code: "connector_registration_failed" }); assert.equal(requests, 1);
  for (const change of [{ client_secret: undefined }, { token_endpoint_auth_method: "none" }, { redirect_uris: ["https://unexpected.test"] }]) {
    await assert.rejects(registerConfidenceClient(valid, { fetchImpl: async (_, init) => Response.json({ ...JSON.parse(init.body), client_id: "client", client_secret: "secret", ...change }) }), { code: "connector_registration_failed" });
  }
  const controller = new AbortController(); controller.abort(); await assert.rejects(registerConfidenceClient(valid, { ...options, signal: controller.signal }), { code: "connector_registration_interrupted" }); assert.equal(requests, 1);
});

test("Both Confidence guides use the portable assistant-only registration contract", async () => {
  for (const { provider } of specs) {
    const text = await readFile(new URL(`../docs/${provider.id}.md`, import.meta.url), "utf8"); const json = text.match(/```json\n([\s\S]*?)\n```/u)[1];
    const config = parseIntegrationConfiguration(json, { providers: [provider] }); const integration = Object.values(config.integrations)[0];
    assert.equal(integration.provider, provider.id); assert.equal(integration.accountMode, "assistant");
    for (const mode of ["shared", "per-user"]) { integration.accountMode = mode; assert.throws(() => parseIntegrationConfiguration(JSON.stringify(config), { providers: [provider] })); }
  }
});


test("Confidence Exp retains actual analysis content and limits calls to approved experiment resources", async t => {
  const spec = specs.find(item => item.provider === confidenceExpProvider);
  const f = await fixture(t, spec); await f.complete(await f.service.beginAuthorization(input));
  const allowed = createConnectionService({ ...f.options, authorize: async (owner, request) =>
    request.operation !== "tools.call" || ["get_experiment", "get_results"].includes(request.input.name) && request.input.arguments.name === spec.arguments.name ? owner : null });
  for (const [name, result] of [["get_experiment", { name: spec.arguments.name, state: "live", analysisResults: ["results/primary"] }],
    ["get_results", { relativeEffect: 0.04, confidenceInterval: [-0.01, 0.09], significant: false, sampleSizes: { control: 200, treatment: 205 }, recommendation: "continue" }]]) {
    f.state.call = { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
    const call = { name, arguments: { name: spec.arguments.name, summary: false } };
    assert.deepEqual(await allowed.invoke({ ...input, operation: "tools.call", input: call }), f.state.call);
    assert.deepEqual(f.requests.findLast(request => request.message?.method === "tools/call").message.params, call);
  }
  const count = f.requests.length;
  await assert.rejects(allowed.invoke({ ...input, operation: "tools.call", input: { name: "get_results", arguments: { name: "workflows/abtest/instances/other" } } }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, count);
});


test("Confidence Flags permits explicitly approved management calls and preserves partial tool failure", async t => {
  const spec = specs.find(item => item.provider === confidenceFlagsProvider);
  const f = await fixture(t, spec); await f.complete(await f.service.beginAuthorization(input));
  // These fixture schemas model discovery, not a claim about every live argument name.
  const calls = [
    { name: "createFlag", arguments: { name: "new-checkout", schema: { type: "boolean" }, variants: [{ name: "off", value: false }] } },
    { name: "addFlagVariant", arguments: { name: "flags/new-checkout", variant: { name: "on", value: true } } },
    { name: "createOverrideRule", arguments: { name: "flags/new-checkout", entity: "test-user", variant: "on" } },
    { name: "testResolveFlag", arguments: { name: "flags/new-checkout", entity: "test-user" } }
  ];
  let approved;
  const host = createConnectionService({ ...f.options, authorize: async (owner, request) =>
    request.operation !== "tools.call" || JSON.stringify(request.input) === JSON.stringify(approved) ? owner : null });
  for (const call of calls) {
    const before = f.requests.length;
    await assert.rejects(host.invoke({ ...input, operation: "tools.call", input: call }), { code: "connector_access_denied" });
    assert.equal(f.requests.length, before);
    approved = call;
    f.state.call = { content: [{ type: "text", text: JSON.stringify({ name: "flags/new-checkout", variant: "on", matchedRule: "test-user-only" }) }], isError: false };
    assert.deepEqual(await host.invoke({ ...input, operation: "tools.call", input: call }), f.state.call);
    assert.deepEqual(f.requests.findLast(request => request.message?.method === "tools/call").message.params, call);
    approved = undefined;
  }
  approved = calls[2]; f.state.call = { content: [{ type: "text", text: "Rule was not saved" }], isError: true };
  assert.deepEqual(await host.invoke({ ...input, operation: "tools.call", input: approved }), f.state.call);
  const before = f.requests.length; f.state.status = 500;
  await assert.rejects(host.invoke({ ...input, operation: "tools.call", input: approved }));
  assert.equal(f.requests.length, before + 1, "uncertain flag writes are not replayed");
});
