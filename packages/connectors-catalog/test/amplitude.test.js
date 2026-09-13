import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { amplitudeProvider, registerAmplitudeClient } from "../src/server/amplitude.js";

const context = { applicationId: "assistant-host", subjectId: "account-owner" };
const input = { context, integrationId: "analytics" };
const callback = "http://127.0.0.1:4919/amplitude/callback";
const scopes = ["mcp:read", "offline_access"];
const discovery = { tools: [{ name: "get_amplitude_context", inputSchema: { type: "object", properties: { project_id: { type: "string" } } } }] };

async function fixture(t, region = "us") {
  const directory = await mkdtemp(path.join(tmpdir(), "amplitude-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" });
  const origin = region === "eu" ? "https://mcp.eu.amplitude.com" : "https://mcp.amplitude.com";
  const state = { time: Date.now(), scopes, status: 200, list: discovery, call: { content: [{ type: "text", text: "Project analytics" }] } };
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: { amplitude: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:AMPLITUDE_CLIENT_SECRET", callbackUrlRef: "env:AMPLITUDE_CALLBACK" } }, integrations: {
      analytics: { provider: "amplitude", accountMode: "assistant", scopes, settings: { region },
        authentication: { method: "oauth2", registrationRef: "amplitude" } }
    } },
    providers: [amplitudeProvider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner, request) => request.operation === "tools.call" &&
      (request.input.name !== "get_amplitude_context" || request.input.arguments.project_id !== "allowed-project") ? null : owner,
    resolveReference: async (reference) => reference === "env:AMPLITUDE_CLIENT_SECRET" ? "fixture-client-secret" : callback,
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const url = String(address);
      requests.push({ url, init, headers: new Headers(init.headers) });
      if (url === `${origin}/token`) {
        if (state.tokenError) return Response.json({ error: state.tokenError, error_description: "fixture-client-secret" }, { status: 400 });
        const refresh = new URLSearchParams(init.body).get("grant_type") === "refresh_token";
        return Response.json({ token_type: "Bearer", access_token: refresh ? "refreshed-access" : "initial-access",
          refresh_token: refresh ? "rotated-refresh" : "initial-refresh", expires_in: 60, scope: state.scopes.join(" ") });
      }
      assert.equal(url, `${origin}/mcp`);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (state.status !== 200) return new Response("initial-access fixture-client-secret", { status: state.status,
        headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://unexpected.invalid/auth"' } });
      const message = JSON.parse(init.body);
      requests.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: "amplitude-fixture", version: "1" } }
        : message.method === "tools/list" ? state.list : state.call;
      if (state.pause && message.method === "tools/call") {
        state.started();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "Mcp-Session-Id": "amplitude-session" } });
    }
  };
  const service = createConnectionService(options);
  const complete = async (start, extra = "code=fixture-code") => service.completeAuthorization({ ...input,
    callbackUrl: `${callback}?state=${new URL(start.authorizationUrl).searchParams.get("state")}&${extra}` });
  return { service, options, state, requests, origin, directory, protection, complete };
}

for (const region of ["us", "eu"]) {
  test(`Amplitude ${region} uses regional PKCE and resource-bound grants, verifies discovery and refreshes after file restart`, async (t) => {
    const { service, options, requests, state, origin, complete, directory, protection } = await fixture(t, region);
    const start = await service.beginAuthorization(input);
    const url = new URL(start.authorizationUrl);
    assert.equal(url.origin + url.pathname, `${origin}/authorize`);
    assert.equal(url.searchParams.get("resource"), origin);
    assert.equal(url.searchParams.get("scope"), scopes.join(" "));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(requests.length, 0);
    assert.equal((await complete(start)).status, "connected");
    const grant = requests.find((request) => request.url === `${origin}/token`);
    const body = new URLSearchParams(grant.init.body);
    assert.equal(body.get("resource"), origin);
    assert.equal(body.get("client_secret"), "fixture-client-secret");
    assert.equal(body.get("redirect_uri"), callback);
    assert(body.get("code_verifier"));
    assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, 0);
    for (const request of requests.filter(({ url }) => url.endsWith("/mcp"))) {
      assert.equal(request.headers.get("authorization"), "Bearer initial-access");
      assert.equal(request.init.redirect, "error");
      assert.equal(request.init.credentials, "omit");
    }
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    state.time += 61_000;
    assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list" }), discovery);
    const refresh = new URLSearchParams(requests.findLast(({ url }) => url.endsWith("/token")).init.body);
    assert.equal(refresh.get("resource"), origin);
    assert.equal(refresh.get("refresh_token"), "initial-refresh");
    assert.equal(requests.at(-1).headers.get("authorization"), "Bearer refreshed-access");
    assert.equal(requests.at(-1).init.method, "DELETE");
    for (const name of await readdir(directory)) {
      const stored = await readFile(path.join(directory, name), "utf8");
      for (const secret of ["initial-access", "refreshed-access", "initial-refresh", "rotated-refresh", "fixture-client-secret", body.get("code_verifier")]) assert(!stored.includes(secret));
    }
    const count = requests.length;
    await assert.rejects(complete(start), { code: "connector_attempt_invalid" });
    for (const owner of [{ ...context, applicationId: "another-host" }, { ...context, subjectId: "another-owner" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "tools.list" }), { code: "connector_reconnect_required" });
    }
    assert.equal(requests.length, count);
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.length, count);
  });
}

test("Amplitude configuration and changed regions cannot bypass account ownership or reuse a pending grant", async (t) => {
  const { options, service, complete, requests } = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [amplitudeProvider] });
  for (const [field, value] of [["accountMode", "shared"], ["accountMode", "per-user"], ["scopes", ["admin"]], ["settings", { region: "https://unexpected.invalid" }]]) {
    const config = structuredClone(options.configuration);
    config.integrations.analytics[field] = value;
    assert.throws(() => parse(config));
  }
  const start = await service.beginAuthorization(input);
  const config = structuredClone(options.configuration);
  config.integrations.analytics.settings.region = "eu";
  const changed = createConnectionService({ ...options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: `${callback}?code=x&state=${new URL(start.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
  await complete(await service.beginAuthorization(input));
  assert.equal((await changed.status(input)).status, "reconnect-required");
  const count = requests.length;
  await assert.rejects(changed.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
});

test("Amplitude authorizes exact tools and arguments, preserves tool errors and cancels without replay", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await complete(await service.beginAuthorization(input));
  const count = requests.length;
  for (const payload of [{ name: "delete_chart", arguments: {} }, { name: "get_amplitude_context", arguments: { project_id: "another-project" } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload }), { code: "connector_access_denied" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "tools.list", input: { url: "https://unexpected.invalid" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  const payload = { name: "get_amplitude_context", arguments: { project_id: "allowed-project" } };
  const analytics = { content: [{ type: "text", text: "Allowed project: checkout analytics and saved funnel reports" }] };
  state.call = analytics;
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: payload }), analytics);
  state.call = { content: [{ type: "text", text: "No matching project" }], isError: true };
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: payload }), state.call);
  assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, payload);
  state.pause = true;
  const started = new Promise((resolve) => { state.started = resolve; });
  const controller = new AbortController();
  const pending = assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload, signal: controller.signal }), { code: "connector_cancelled" });
  await started;
  controller.abort();
  await pending;
  assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, 3);
  assert.equal(requests.at(-1).init.method, "DELETE");
});

test("Amplitude denied consent, missing read permission and malformed discovery never create a grant", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await assert.rejects(complete(await service.beginAuthorization(input), "error=access_denied"), { code: "connector_consent_denied" });
  assert.equal(requests.length, 0);
  state.scopes = ["mcp:write"];
  await assert.rejects(complete(await service.beginAuthorization(input)), { code: "connector_scope_missing" });
  assert.equal(requests.length, 1);
  state.scopes = scopes;
  state.list = { wrong: [] };
  await assert.rejects(complete(await service.beginAuthorization(input)), { code: "connector_provider_failed" });
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Amplitude HTTP and refresh failures are sanitized and do not follow authentication metadata", async (t) => {
  const { service, complete, requests, state, origin } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    await assert.rejects(complete(await service.beginAuthorization(input)), (error) => {
      assert.equal(error.code, code);
      assert(!error.message.includes("fixture-client-secret"));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert(requests.every(({ url }) => url === `${origin}/mcp` || url === `${origin}/token`));
  state.status = 200;
  await complete(await service.beginAuthorization(input));
  state.time += 61_000;
  state.tokenError = "invalid_grant";
  await assert.rejects(service.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Amplitude registration uses the SDK and exact regional endpoint with explicit confidential client metadata", async () => {
  for (const region of ["us", "eu"]) {
    const requests = [];
    const result = await registerAmplitudeClient({ region, clientName: "My assistant", callbackUrl: callback, scopes }, {
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json({ ...JSON.parse(init.body), client_id: "created-client", client_secret: "created-secret", client_secret_expires_at: 0 });
      }
    });
    assert.deepEqual(result, { clientId: "created-client", clientSecret: "created-secret", clientSecretExpiresAt: 0 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, region === "eu" ? "https://mcp.eu.amplitude.com/register" : "https://mcp.amplitude.com/register");
    assert.equal(requests[0].init.redirect, "error");
    assert.equal(requests[0].init.credentials, "omit");
    assert.deepEqual(JSON.parse(requests[0].init.body), { client_name: "My assistant", redirect_uris: [callback], token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: scopes.join(" ") });
  }
});

test("Amplitude registration rejects invalid input before HTTP and sanitizes ambiguous provider results without retry", async () => {
  const valid = { clientName: "CLI client", callbackUrl: callback, scopes };
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; throw new Error("secret-provider-response"); } };
  for (const fields of [{ region: "other" }, { callbackUrl: "http://remote.example/callback" }, { callbackUrl: "https://user:secret@example.test/callback" },
    { callbackUrl: "https://example.test/callback?other=1" }, { scopes: [] }, { scopes: ["mcp:write"] }, { scopes: ["mcp:read", "mcp:read"] }, { clientName: "" }]) {
    await assert.rejects(registerAmplitudeClient({ ...valid, ...fields }, options));
  }
  assert.equal(requests, 0);
  await assert.rejects(registerAmplitudeClient(valid, options), (error) => {
    assert.equal(error.code, "connector_registration_failed");
    assert.equal(error.cause, undefined);
    assert(!error.message.includes("secret-provider-response"));
    return true;
  });
  assert.equal(requests, 1);
  for (const changes of [{ client_secret: undefined }, { token_endpoint_auth_method: "none" }, { redirect_uris: ["https://unexpected.invalid"] }]) {
    await assert.rejects(registerAmplitudeClient(valid, { fetchImpl: async (url, init) => Response.json({ ...JSON.parse(init.body),
      client_id: "client", client_secret: "secret", ...changes }) }), { code: "connector_registration_failed" });
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registerAmplitudeClient(valid, { ...options, signal: controller.signal }), { code: "connector_registration_interrupted" });
  assert.equal(requests, 1);
});
