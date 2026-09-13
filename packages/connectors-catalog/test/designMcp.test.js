import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { figmaProvider, registerFigmaClient } from "../src/server/figma.js";
import { miroProvider, registerMiroClient } from "../src/server/miro.js";
import { sanityProvider, registerSanityClient } from "../src/server/sanity.js";
import { sentryProvider, registerSentryClient } from "../src/server/sentry.js";

const context = { applicationId: "assistant-host", subjectId: "account-owner" };
const input = { context, integrationId: "design" };
const callback = "http://127.0.0.1:4919/design/callback";
const cases = [
  { provider: sentryProvider, register: registerSentryClient, scopes: ["org:read"],
    settings: { organizationSlug: "example", projectSlug: "web-app" },
    issuer: "https://mcp.sentry.dev", resource: "https://mcp.sentry.dev/mcp/example/web-app",
    authorizeUrl: "https://mcp.sentry.dev/oauth/authorize", tokenUrl: "https://mcp.sentry.dev/oauth/token",
    registerUrl: "https://mcp.sentry.dev/oauth/register", endpoint: "https://mcp.sentry.dev/mcp/example/web-app",
    tool: { name: "get_issue_details", arguments: { organizationSlug: "example", issueId: "WEB-1" } } },
  { provider: sanityProvider, register: registerSanityClient, scopes: ["global"],
    issuer: "https://mcp.sanity.io", resource: "https://mcp.sanity.io",
    authorizeUrl: "https://mcp.sanity.io/authorize", tokenUrl: "https://mcp.sanity.io/token",
    registerUrl: "https://mcp.sanity.io/register", endpoint: "https://mcp.sanity.io/",
    tool: { name: "get_schema", arguments: { projectId: "project1", dataset: "production" } } },
  { provider: figmaProvider, register: registerFigmaClient, scopes: ["mcp:connect"],
    issuer: "https://api.figma.com", authorizeUrl: "https://www.figma.com/oauth/mcp",
    tokenUrl: "https://api.figma.com/v1/oauth/token", registerUrl: "https://api.figma.com/v1/oauth/mcp/register",
    endpoint: "https://mcp.figma.com/mcp", tool: { name: "get_design_context", arguments: { fileKey: "allowed-file", nodeId: "1:2" } } },
  { provider: miroProvider, register: registerMiroClient, scopes: ["boards:read"],
    issuer: "https://mcp.miro.com/", authorizeUrl: "https://mcp.miro.com/authorize",
    tokenUrl: "https://mcp.miro.com/token", registerUrl: "https://mcp.miro.com/register",
    endpoint: "https://mcp.miro.com/", tool: { name: "board_search_boards", arguments: { query: "planning" } } }
];

async function fixture(t, spec) {
  const directory = await mkdtemp(path.join(tmpdir(), `${spec.provider.id}-connector-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" });
  const state = { time: Date.now(), scopes: spec.scopes, status: 200,
    list: { tools: [{ name: spec.tool.name, inputSchema: { type: "object" } }] },
    result: { content: [{ type: "text", text: "Design content" }] } };
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: { client: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:DESIGN_SECRET", callbackUrlRef: "env:DESIGN_CALLBACK" } }, integrations: {
      design: { provider: spec.provider.id, accountMode: "assistant", scopes: spec.scopes,
        authentication: { method: "oauth2", registrationRef: "client" }, ...(spec.settings ? { settings: spec.settings } : {}) }
    } },
    providers: [spec.provider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner, request) => request.operation === "tools.call" &&
      (request.input.name !== spec.tool.name || JSON.stringify(request.input.arguments) !== JSON.stringify(spec.tool.arguments)) ? null : owner,
    resolveReference: async (ref) => ref === "env:DESIGN_SECRET" ? "fixture-client-secret" : callback,
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const url = String(address);
      requests.push({ url, init, headers: new Headers(init.headers) });
      if (url === spec.tokenUrl) {
        if (state.tokenError) return Response.json({ error: state.tokenError, error_description: "fixture-client-secret" }, { status: 400 });
        const refresh = new URLSearchParams(init.body).get("grant_type") === "refresh_token";
        return Response.json({ token_type: "Bearer", access_token: refresh ? "refreshed-access" : "initial-access",
          refresh_token: refresh ? "rotated-refresh" : "initial-refresh", expires_in: 60, scope: state.scopes.join(" ") });
      }
      assert.equal(url, spec.endpoint);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (state.status !== 200) return new Response("initial-access fixture-client-secret", { status: state.status,
        headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://unexpected.invalid/auth"' } });
      const message = JSON.parse(init.body);
      requests.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (state.pause && message.method === "tools/call") {
        state.started();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: spec.provider.id, version: "1" } }
        : message.method === "tools/list" ? state.list : state.result;
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "Mcp-Session-Id": "fixture-session" } });
    }
  };
  const service = createConnectionService(options);
  const complete = (start, extra = "code=fixture-code", issuer = spec.issuer) => service.completeAuthorization({ ...input,
    callbackUrl: `${callback}?state=${new URL(start.authorizationUrl).searchParams.get("state")}&${extra}&iss=${encodeURIComponent(issuer)}` });
  return { service, options, state, requests, directory, protection, complete };
}

for (const spec of cases) {
  test(`${spec.provider.name} binds consent, PKCE and refresh to its authority and persists isolated encrypted grants`, async (t) => {
    const { service, options, requests, state, complete, directory, protection } = await fixture(t, spec);
    const start = await service.beginAuthorization(input);
    const url = new URL(start.authorizationUrl);
    assert.equal(url.origin + url.pathname, spec.authorizeUrl);
    assert.equal(url.searchParams.get("resource"), spec.resource || spec.endpoint);
    assert.equal(url.searchParams.get("scope"), spec.scopes.join(" "));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(requests.length, 0);
    assert.equal((await complete(start)).status, "connected");
    const grant = new URLSearchParams(requests.find(({ url }) => url === spec.tokenUrl).init.body);
    assert.equal(grant.get("resource"), spec.resource || spec.endpoint);
    assert.equal(grant.get("client_secret"), "fixture-client-secret");
    assert.equal(grant.get("redirect_uri"), callback);
    assert(grant.get("code_verifier"));
    assert(!requests.some(({ message }) => message?.method === "tools/call"));
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    state.time += 61_000;
    assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: { cursor: "next-page" } }), state.list);
    const refresh = new URLSearchParams(requests.findLast(({ url }) => url === spec.tokenUrl).init.body);
    assert.equal(refresh.get("resource"), spec.resource || spec.endpoint);
    assert.equal(refresh.get("refresh_token"), "initial-refresh");
    assert.equal(requests.at(-1).headers.get("authorization"), "Bearer refreshed-access");
    assert.equal(requests.at(-1).init.method, "DELETE");
    assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/list").message.params, { cursor: "next-page" });
    for (const request of requests) {
      assert.equal(request.init.redirect, request.url === spec.tokenUrl ? "manual" : "error");
      if (request.url !== spec.tokenUrl) assert.equal(request.init.credentials, "omit");
      assert.equal(request.headers.get("cookie"), null);
    }
    for (const name of await readdir(directory)) {
      const text = await readFile(path.join(directory, name), "utf8");
      for (const secret of ["initial-access", "refreshed-access", "initial-refresh", "rotated-refresh", grant.get("code_verifier")]) assert(!text.includes(secret));
    }
    const count = requests.length;
    await assert.rejects(complete(start), { code: "connector_attempt_invalid" });
    for (const owner of [{ ...context, applicationId: "another-host" }, { ...context, subjectId: "another-owner" }]) {
      await assert.rejects(restarted.invoke({ ...input, context: owner, operation: "tools.list" }), { code: "connector_reconnect_required" });
    }
    await restarted.disconnect(input);
    assert.equal((await service.status(input)).status, "disconnected");
    assert.equal(requests.length, count);
  });

  test(`${spec.provider.name} rejects wrong issuers, denied consent, replay and changed configuration before token exchange`, async (t) => {
    const { service, complete, requests, options } = await fixture(t, spec);
    const start = await service.beginAuthorization(input);
    await assert.rejects(complete(start, "code=x", "https://wrong.invalid"), { code: "connector_provider_failed" });
    await assert.rejects(complete(start), { code: "connector_attempt_invalid" });
    await assert.rejects(complete(await service.beginAuthorization(input), "error=access_denied"), { code: "connector_consent_denied" });
    const changed = structuredClone(options.configuration);
    changed.registrations.client.clientId = "replacement-client";
    const pending = await service.beginAuthorization(input);
    const other = createConnectionService({ ...options, configuration: changed });
    await assert.rejects(other.completeAuthorization({ ...input, callbackUrl: `${callback}?code=x&state=${new URL(pending.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
    for (const fields of [{ accountMode: "per-user" }, { scopes: [] }, { scopes: ["admin"] }]) {
      const invalid = structuredClone(options.configuration);
      Object.assign(invalid.integrations.design, fields);
      assert.throws(() => parseIntegrationConfiguration(JSON.stringify(invalid), { providers: [spec.provider] }));
    }
    assert.equal(requests.length, 0);
  });

  test(`${spec.provider.name} enforces exact tool arguments, retains tool errors and cancels without replay`, async (t) => {
    const { service, complete, requests, state } = await fixture(t, spec);
    await complete(await service.beginAuthorization(input));
    const count = requests.length;
    for (const payload of [{ name: "unapproved_write", arguments: {} }, { ...spec.tool, arguments: {} }]) {
      await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload }), { code: "connector_access_denied" });
    }
    await assert.rejects(service.invoke({ ...input, operation: "tools.list", input: { url: "https://wrong.invalid" } }), { code: "connector_input_invalid" });
    assert.equal(requests.length, count);
    if (spec.provider.id === "sanity") {
      state.result = { content: [{ type: "text", text: JSON.stringify({ types: [{ name: "article", fields: [{ name: "title", type: "string" }] }] }) }] };
      assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: spec.tool }), state.result);
      assert.equal(requests.at(-1).init.method, "DELETE");
    }
    state.result = { content: [{ type: "text", text: "The board or design is not accessible" }], isError: true };
    assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: spec.tool }), state.result);
    assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, spec.tool);
    state.pause = true;
    const started = new Promise((resolve) => { state.started = resolve; });
    const controller = new AbortController();
    const pending = assert.rejects(service.invoke({ ...input, operation: "tools.call", input: spec.tool, signal: controller.signal }), { code: "connector_cancelled" });
    await started;
    controller.abort();
    await pending;
    assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, spec.provider.id === "sanity" ? 3 : 2);
    assert.equal(requests.at(-1).init.method, "DELETE");
  });

  test(`${spec.provider.name} handles empty discovery, invalid discovery, HTTP errors and expired refresh grants`, async (t) => {
    const { service, complete, requests, state } = await fixture(t, spec);
    state.list = { malformed: [] };
    await assert.rejects(complete(await service.beginAuthorization(input)), { code: "connector_provider_failed" });
    assert.equal((await service.status(input)).status, "disconnected");
    state.list = { tools: [] };
    for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
      state.status = status;
      await assert.rejects(complete(await service.beginAuthorization(input)), (error) => {
        assert.equal(error.code, code);
        assert(!error.message.includes("fixture-client-secret"));
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    state.status = 200;
    await complete(await service.beginAuthorization(input));
    assert.deepEqual(await service.invoke({ ...input, operation: "tools.list" }), { tools: [] });
    assert(requests.every(({ url }) => [spec.tokenUrl, spec.endpoint].includes(url)));
    state.time += 61_000;
    state.tokenError = "invalid_grant";
    await assert.rejects(service.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
    assert.equal((await service.status(input)).status, "reconnect-required");
  });

  test(`${spec.provider.name} registers one confidential client with the exact callback and approved scopes`, async () => {
    const requests = [];
    const values = { clientName: "My assistant", callbackUrl: callback, ...(spec.provider.id !== "figma" ? { scopes: spec.scopes } : {}) };
    const result = await spec.register(values, { fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ ...JSON.parse(init.body), client_id: "created-client", client_secret: "created-secret", client_secret_expires_at: 0 });
    } });
    assert.deepEqual(result, { clientId: "created-client", clientSecret: "created-secret", clientSecretExpiresAt: 0 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, spec.registerUrl);
    assert.deepEqual(JSON.parse(requests[0].init.body), { client_name: "My assistant", redirect_uris: [callback],
      token_endpoint_auth_method: "client_secret_post", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: spec.scopes.join(" ") });
    assert.equal(requests[0].init.redirect, "error");
    assert.equal(requests[0].init.credentials, "omit");
  });

  test(`${spec.provider.name} rejects unsafe setup inputs and ambiguous registration without retry`, async () => {
    const values = { clientName: "My assistant", callbackUrl: callback, ...(spec.provider.id !== "figma" ? { scopes: spec.scopes } : {}) };
    let requests = 0;
    const options = { fetchImpl: async () => { requests++; throw new Error("provider-secret"); } };
    for (const changes of [{ callbackUrl: "http://remote.example/callback" }, { callbackUrl: "https://example.test/cb?secret=1" }, { clientName: "" }, { scopes: ["admin"] }]) {
      await assert.rejects(spec.register({ ...values, ...changes }, options));
      assert.equal(requests, 0);
    }
    await assert.rejects(spec.register(values, options), (error) => {
      assert.equal(error.code, "connector_registration_failed");
      assert(!error.message.includes("provider-secret"));
      return true;
    });
    assert.equal(requests, 1);
    for (const changes of [{ client_secret: undefined }, { token_endpoint_auth_method: "none" }, { redirect_uris: ["https://wrong.invalid"] }]) {
      await assert.rejects(spec.register(values, { fetchImpl: async (url, init) => Response.json({ ...JSON.parse(init.body),
        client_id: "client", client_secret: "secret", ...changes }) }), { code: "connector_registration_failed" });
    }
  });
}

test("Sentry returns issue context only after exact tool authorization and rejects resource changes", async (t) => {
  const spec = cases.find(({ provider }) => provider.id === "sentry");
  const { service, options, complete, state, requests } = await fixture(t, spec);
  await complete(await service.beginAuthorization(input));
  state.result = { content: [{ type: "text", text: JSON.stringify({
    issueId: "WEB-1", title: "Checkout failed", status: "unresolved", count: 7,
    project: "web-app", culprit: "checkout.submit", lastSeen: "2026-09-13T00:00:00Z"
  }) }] };
  const before = requests.length;
  for (const attempted of [
    { ...spec.tool, arguments: { ...spec.tool.arguments, organizationSlug: "private" } },
    { ...spec.tool, arguments: { ...spec.tool.arguments, issueId: "SECRET-1" } },
    { name: "update_issue", arguments: { issueId: "WEB-1", status: "resolved" } }
  ]) await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: attempted }), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
  const result = await service.invoke({ ...input, operation: "tools.call", input: spec.tool });
  assert.equal(JSON.parse(result.content[0].text).title, "Checkout failed");
  assert.deepEqual(result, state.result);
  const changed = structuredClone(options.configuration);
  changed.integrations.design.settings.projectSlug = "other-project";
  const other = createConnectionService({ ...options, configuration: changed });
  const count = requests.length;
  await assert.rejects(other.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
  assert.equal(requests.length, count);
});

test("Sanity retrieves bounded content with exact project dataset and query authorization", async (t) => {
  const spec = cases.find(({ provider }) => provider.id === "sanity");
  const tool = { name: "query_documents", arguments: {
    projectId: "project1", dataset: "production", query: '*[_type == "article"][0...10]{_id,title}'
  } };
  const { service, complete, requests, state } = await fixture(t, { ...spec, tool });
  await complete(await service.beginAuthorization(input));
  state.result = { content: [{ type: "text", text: JSON.stringify([
    { _id: "article-1", title: "Appointment care guide" }, { _id: "article-2", title: "" }
  ]) }] };
  const before = requests.length;
  for (const attempted of [
    { ...tool, arguments: { ...tool.arguments, dataset: "private" } },
    { ...tool, arguments: { ...tool.arguments, projectId: "another-project" } },
    { ...tool, arguments: { ...tool.arguments, query: "*[]" } },
    { name: "publish_documents", arguments: { projectId: "project1", dataset: "production", documentIds: ["article-1"] } }
  ]) await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: attempted }), { code: "connector_access_denied" });
  assert.equal(requests.length, before);
  const result = await service.invoke({ ...input, operation: "tools.call", input: tool });
  assert.deepEqual(JSON.parse(result.content[0].text), [
    { _id: "article-1", title: "Appointment care guide" }, { _id: "article-2", title: "" }
  ]);
  assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, tool);
  assert.equal(requests.at(-1).init.method, "DELETE");
  await service.disconnect(input);
  const disconnected = requests.length;
  await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: tool }));
  assert.equal(requests.length, disconnected);
});


test("Figma delivers authorized design context and screenshot content without granting other file access", async t => {
  const spec = cases.find(({ provider }) => provider.id === "figma");
  const f = await fixture(t, spec); await f.complete(await f.service.beginAuthorization(input));
  f.state.result = { content: [
    { type: "text", text: JSON.stringify({ nodeId: "1:2", name: "Booking card", layout: { direction: "vertical", gap: 16 }, children: [{ name: "Book appointment", role: "button" }] }) },
    { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }
  ] };
  const before = f.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "tools.call", input: { ...spec.tool, arguments: { ...spec.tool.arguments, fileKey: "private-file" } } }), { code: "connector_access_denied" });
  assert.equal(f.requests.length, before);
  const result = await f.service.invoke({ ...input, operation: "tools.call", input: spec.tool });
  assert.equal(JSON.parse(result.content[0].text).children[0].name, "Book appointment");
  assert.deepEqual(result.content[1], f.state.result.content[1]);
  assert.deepEqual(f.requests.findLast(({ message }) => message?.method === "tools/call").message.params, spec.tool);
  await f.service.disconnect(input); const disconnected = f.requests.length;
  await assert.rejects(f.service.invoke({ ...input, operation: "tools.call", input: spec.tool }));
  assert.equal(f.requests.length, disconnected);
});

test("Miro returns authorized board context and diagram results without granting other boards", async t => {
  const original = cases.find(({ provider }) => provider.id === "miro");
  // Controlled discovery names are fixture tools, not a pinned Miro tool catalogue.
  for (const tool of [{ name: "fixture_read_board", arguments: { boardId: "board-one" } },
    { name: "fixture_create_diagram", arguments: { boardId: "board-one", diagram: "Start -> Review" } }]) {
    const spec = { ...original, scopes: ["boards:read", "boards:write"], tool };
    const f = await fixture(t, spec); await f.complete(await f.service.beginAuthorization(input));
    f.state.result = { content: [{ type: "text", text: JSON.stringify({ boardId: "board-one", items: [{ id: "item-one", text: "Review booking", x: 100, y: 200 }] }) }] };
    const before = f.requests.length;
    await assert.rejects(f.service.invoke({ ...input, operation: "tools.call", input: { ...tool, arguments: { ...tool.arguments, boardId: "other-board" } } }), { code: "connector_access_denied" });
    assert.equal(f.requests.length, before);
    const result = await f.service.invoke({ ...input, operation: "tools.call", input: tool });
    assert.equal(JSON.parse(result.content[0].text).items[0].text, "Review booking");
    assert.deepEqual(f.requests.findLast(({ message }) => message?.method === "tools/call").message.params, tool);
  }
});
