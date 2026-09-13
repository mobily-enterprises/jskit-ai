import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { canvaProvider } from "../src/server/canva.js";

import { createCanvaClientMetadata } from "../src/shared/canva.js";

const context = { applicationId: "assistant-host", subjectId: "account-owner" };
const input = { context, integrationId: "work" };
const callback = "http://127.0.0.1:4919/canva/callback";
const resource = "https://mcp.canva.com";
const clientId = "https://assistant.example/oauth/canva.json";
const endpoint = `${resource}/mcp`;
const tokenEndpoint = "https://mcp.canva.com/token";
const scopes = ["profile:read", "design:meta:read"];
const discovery = { tools: [{ name: "get-design", inputSchema: { type: "object", properties: { design_id: { type: "string" } } } }] };

async function fixture(t, selectedScopes = scopes) {
  const directory = await mkdtemp(path.join(tmpdir(), "canva-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" });
  const state = { time: Date.now(), scopes: selectedScopes, status: 200, list: discovery, call: { content: [{ type: "text", text: "Project work" }] } };
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: { canva: { source: "own", clientId: clientId, tokenEndpointAuthMethod: "none", callbackUrlRef: "env:CANVA_CALLBACK" } }, integrations: {
      work: { provider: "canva", accountMode: "assistant", scopes: selectedScopes,
        authentication: { method: "oauth2", registrationRef: "canva" } }
    } },
    providers: [canvaProvider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner, request) => request.operation === "tools.call" &&
      (state.authorizeTool ? !state.authorizeTool(request.input) :
        request.input.name !== "get-design" || request.input.arguments.design_id !== "allowed-design") ? null : owner,
    resolveReference: async (reference) => { assert.equal(reference, "env:CANVA_CALLBACK"); return callback; },
    fetchImpl: async (address, init) => {
      init.signal.throwIfAborted();
      const url = String(address);
      requests.push({ url, init, headers: new Headers(init.headers) });
      if (url === tokenEndpoint) {
        if (state.tokenError) return Response.json({ error: state.tokenError, error_description: "fixture-client-secret" }, { status: 400 });
        const refresh = new URLSearchParams(init.body).get("grant_type") === "refresh_token";
        return Response.json({ token_type: "Bearer", access_token: refresh ? "refreshed-access" : "initial-access",
          refresh_token: refresh ? "rotated-refresh" : "initial-refresh", expires_in: 60, scope: state.scopes.join(" ") });
      }
      assert.equal(url, endpoint);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (state.status !== 200) return new Response("initial-access fixture-client-secret", { status: state.status,
        headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://unexpected.invalid/auth"' } });
      const message = JSON.parse(init.body);
      requests.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: "canva-fixture", version: "1" } }
        : message.method === "tools/list" ? state.list : state.call;
      if (state.pause && message.method === "tools/call") {
        state.started();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "Mcp-Session-Id": "canva-session" } });
    }
  };
  const service = createConnectionService(options);
  const complete = async (start, extra = "code=fixture-code") => service.completeAuthorization({ ...input,
    callbackUrl: `${callback}?state=${new URL(start.authorizationUrl).searchParams.get("state")}&${extra}` });
  return { service, options, state, requests, directory, protection, complete };
}


test("Canva metadata clients exchange and refresh PKCE grants without client secrets after file restart", async (t) => {
  const { service, options, requests, state, complete, directory, protection } = await fixture(t);
  const durations = [];
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (duration) => { durations.push(duration); return timeout(duration); });
  const start = await service.beginAuthorization(input);
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://mcp.canva.com/authorize");
  assert.equal(url.searchParams.get("resource"), resource);
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("scope"), scopes.join(" "));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(requests.length, 0);
  assert.equal((await complete(start)).status, "connected");
  const grant = new URLSearchParams(requests.find(({ url }) => url === tokenEndpoint).init.body);
  assert.equal(grant.get("resource"), resource);
  assert.equal(grant.get("client_id"), clientId);
  assert.equal(grant.has("client_secret"), false);
  assert.equal(requests.find(({ url }) => url === tokenEndpoint).headers.get("authorization"), null);
  assert.equal(grant.get("redirect_uri"), callback);
  assert(grant.get("code_verifier"));
  assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, 0);
  const initialized = requests.find(({ message }) => message?.method === "initialize");
  assert.deepEqual(initialized.message.params.capabilities, {});
  for (const request of requests.filter(({ url }) => url === endpoint)) {
    assert.equal(request.headers.get("authorization"), "Bearer initial-access");
    assert.equal(request.init.redirect, "error");
    assert.equal(request.init.credentials, "omit");
  }
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  state.time += 61_000;
  assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: { cursor: "next-page" } }), discovery);
  assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/list").message.params, { cursor: "next-page" });
  const refresh = new URLSearchParams(requests.findLast(({ url }) => url === tokenEndpoint).init.body);
  assert.equal(refresh.get("resource"), resource);
  assert.equal(refresh.get("refresh_token"), "initial-refresh");
  assert.equal(refresh.get("client_id"), clientId);
  assert.equal(refresh.has("client_secret"), false);
  assert.equal(requests.at(-1).headers.get("authorization"), "Bearer refreshed-access");
  assert.equal(requests.at(-1).init.method, "DELETE");
  for (const name of await readdir(directory)) {
    const stored = await readFile(path.join(directory, name), "utf8");
    for (const secret of ["initial-access", "refreshed-access", "initial-refresh", "rotated-refresh", "fixture-client-secret", grant.get("code_verifier")]) assert(!stored.includes(secret));
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
  assert(durations.includes(60_000));
  assert(durations.includes(15_000));
});

test("Canva validates metadata URLs, client type and permissions before reusing a consent attempt", async (t) => {
  const { options, service, requests } = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [canvaProvider] });
  for (const [field, value] of [["accountMode", "shared"], ["accountMode", "per-user"], ["scopes", ["admin"]], ["scopes", []]]) {
    const config = structuredClone(options.configuration);
    config.integrations.work[field] = value;
    assert.throws(() => parse(config));
  }
  const config = structuredClone(options.configuration);
  config.integrations.work.scopes = canvaProvider.scopes.map(({ value }) => value);
  assert.deepEqual(parse(config).integrations.work.scopes, config.integrations.work.scopes);
  assert(canvaProvider.scopes.filter(({ value }) => /:write$/.test(value)).every(({ recommended }) => !recommended));
  for (const clientId of ["ordinary-client", "https://assistant.example", "http://assistant.example/client.json", "https://user:secret@assistant.example/client.json", "https://assistant.example/client.json?key=secret"]) {
    const invalid = structuredClone(options.configuration);
    invalid.registrations.canva.clientId = clientId;
    assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["registrations.canva.clientId"]));
  }
  const invalid = structuredClone(options.configuration);
  invalid.registrations.canva.clientSecretRef = "env:SHOULD_NOT_BE_USED";
  assert.throws(() => parse(invalid), (error) => Boolean(error.fieldErrors["registrations.canva.clientSecretRef"]));
  const start = await service.beginAuthorization(input);
  const changed = createConnectionService({ ...options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: `${callback}?code=x&state=${new URL(start.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
});

test("Canva authorizes the exact tool and destination design, preserves tool errors and cancels without replay", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await complete(await service.beginAuthorization(input));
  const count = requests.length;
  for (const payload of [{ name: "delete-design", arguments: {} }, { name: "get-design", arguments: { design_id: "another-design" } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload }), { code: "connector_access_denied" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "tools.list", input: { url: "https://unexpected.invalid" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  const payload = { name: "get-design", arguments: { design_id: "allowed-design" } };
  state.call = { content: [{ type: "text", text: "This issue is not accessible" }], isError: true };
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: payload }), state.call);
  assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, payload);
  state.pause = true;
  const started = new Promise((resolve) => { state.started = resolve; });
  const controller = new AbortController();
  const pending = assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload, signal: controller.signal }), { code: "connector_cancelled" });
  await started;
  controller.abort();
  await pending;
  assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, 2);
  assert.equal(requests.at(-1).init.method, "DELETE");
});

test("Canva declined consent and malformed discovery do not persist a connection", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await assert.rejects(complete(await service.beginAuthorization(input), "error=access_denied"), { code: "connector_consent_denied" });
  assert.equal(requests.length, 0);
  state.list = { wrong: [] };
  await assert.rejects(complete(await service.beginAuthorization(input)), { code: "connector_provider_failed" });
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Canva preserves the provider's reduced grant and permits empty discovery without claiming product access", async (t) => {
  const { service, complete, state, requests } = await fixture(t);
  state.scopes = ["profile:read"];
  state.list = { tools: [] };
  const connected = await complete(await service.beginAuthorization(input));
  assert.deepEqual(connected.grantedScopes, ["profile:read"]);
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.list" }), { tools: [] });
  assert(!requests.some(({ message }) => message?.method === "tools/call"));
});

test("Canva sanitizes HTTP/refresh failures, persists reconnect status and never follows injected auth metadata", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  for (const [status, code] of [[401, "connector_reconnect_required"], [403, "connector_permission_denied"], [429, "connector_rate_limited"], [500, "connector_provider_failed"]]) {
    state.status = status;
    await assert.rejects(complete(await service.beginAuthorization(input)), (error) => {
      assert.equal(error.code, code);
      assert(!error.message.includes("fixture-client-secret"));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
  assert(requests.every(({ url }) => url === endpoint || url === tokenEndpoint));
  state.status = 200;
  await complete(await service.beginAuthorization(input));
  state.time += 61_000;
  state.tokenError = "invalid_grant";
  await assert.rejects(service.invoke({ ...input, operation: "tools.list" }), { code: "connector_reconnect_required" });
  assert.equal((await service.status(input)).status, "reconnect-required");
});

test("Canva client metadata is a portable secret-free document with an exact identity and callback", () => {
  const metadata = createCanvaClientMetadata({ clientId, clientName: "My assistant", callbackUrl: callback });
  assert.deepEqual(metadata, { client_id: clientId, client_name: "My assistant", redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
  assert.deepEqual(JSON.parse(JSON.stringify(metadata)), metadata);
  for (const changes of [{ clientId: "http://example.test/client.json" }, { clientId: "https://example.test/" },
    { clientId: "https://example.test/client.json#fragment" }, { clientName: "" }, { callbackUrl: "http://remote.example/callback" },
    { callbackUrl: "https://example.test/callback?secret=1" }, { clientSecret: "raw-secret" }]) {
    assert.throws(() => createCanvaClientMetadata({ clientId, clientName: "Client", callbackUrl: callback, ...changes }));
  }
});


test("Canva design creation and editing preserve draft versus committed results and exact host approval", async t => {
  const { service, complete, state, requests } = await fixture(t, [...scopes, "design:content:write"]);
  await complete(await service.beginAuthorization(input));
  const steps = [
    ["create-design-from-candidate", { job_id: "job-1", candidate_id: "chosen-1" }, { design_summary: { id: "allowed-design", title: "Grooming offer", urls: { edit_url: "https://www.canva.com/d/fixture" } } }],
    ["start-editing-transaction", { design_id: "allowed-design" }, { transaction: { status: "open", transaction_id: "txn-1" }, richtexts: [{ page_index: 1, element_id: "headline", regions: [{ type: "character", text: "Old headline" }] }] }],
    ["perform-editing-operations", { transaction_id: "txn-1", page_index: 1, operations: [{ type: "replace_text", element_id: "headline", text: "Spring grooming" }] }, { edit_operation_results: [{ status: "success", operation_info: { type: "replace_text", element_id: "headline" } }] }],
    ["commit-editing-transaction", { transaction_id: "txn-1" }, { transaction: { id: "txn-1", status: "committed" } }]
  ];
  for (const [name, arguments_, result] of steps) {
    const payload = { name, arguments: arguments_ };
    state.authorizeTool = candidate => JSON.stringify(candidate) === JSON.stringify(payload);
    state.call = { content: [{ type: "text", text: JSON.stringify(result) }] };
    const count = requests.length;
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: { name, arguments: { ...arguments_, design_id: "unapproved-design" } } }), { code: "connector_access_denied" });
    assert.equal(requests.length, count);
    const response = await service.invoke({ ...input, operation: "tools.call", input: payload });
    assert.deepEqual(JSON.parse(response.content[0].text), result);
    assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, payload);
  }
  state.call = { isError: true, content: [{ type: "text", text: "Concurrent edit: cancel and start a fresh transaction" }] };
  const count = requests.filter(({ message }) => message?.method === "tools/call").length;
  const failed = await service.invoke({ ...input, operation: "tools.call", input: { name: "commit-editing-transaction", arguments: { transaction_id: "txn-1" } } });
  assert.equal(failed.isError, true);
  assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, count + 1);
});
