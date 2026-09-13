import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { parseIntegrationConfiguration } from "../../connectors-core/src/shared/configuration.js";
import { atlassianProvider, registerAtlassianClient } from "../src/server/atlassian.js";

const context = { applicationId: "assistant-host", subjectId: "account-owner" };
const input = { context, integrationId: "work" };
const callback = "http://127.0.0.1:4919/atlassian/callback";
const resource = "https://mcp.atlassian.com/v2/mcp";
const endpoint = `${resource}?tools=all`;
const tokenEndpoint = "https://auth.atlassian.com/oauth/token";
const registrationEndpoint = "https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register";
const scopes = ["read:me", "read:jira:agent-interface", "offline_access"];
const discovery = { tools: [{ name: "getJiraIssue", inputSchema: { type: "object", properties: { cloudId: { type: "string" } } } }] };

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "atlassian-connector-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" });
  const state = { time: Date.now(), scopes, status: 200, list: discovery, call: { content: [{ type: "text", text: "Project work" }] } };
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: { atlassian: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:ATLASSIAN_CLIENT_SECRET", callbackUrlRef: "env:ATLASSIAN_CALLBACK" } }, integrations: {
      work: { provider: "atlassian", accountMode: "assistant", scopes,
        authentication: { method: "oauth2", registrationRef: "atlassian" } }
    } },
    providers: [atlassianProvider], store: createFileConnectionStore({ directory, protection }), now: () => state.time,
    authorize: async (owner, request) => request.operation === "tools.call" &&
      (!["getJiraIssue", "getConfluencePage"].includes(request.input.name) || request.input.arguments.cloudId !== "allowed-site") ? null : owner,
    resolveReference: async (reference) => reference === "env:ATLASSIAN_CLIENT_SECRET" ? "fixture-client-secret" : callback,
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
        capabilities: { tools: {} }, serverInfo: { name: "atlassian-fixture", version: "1" } }
        : message.method === "tools/list" ? state.list : state.call;
      if (state.pause && message.method === "tools/call") {
        state.started();
        return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "Mcp-Session-Id": "atlassian-session" } });
    }
  };
  const service = createConnectionService(options);
  const complete = async (start, extra = "code=fixture-code") => service.completeAuthorization({ ...input,
    callbackUrl: `${callback}?state=${new URL(start.authorizationUrl).searchParams.get("state")}&${extra}` });
  return { service, options, state, requests, directory, protection, complete };
}


test("Atlassian v2 binds PKCE and resource grants to its authorization server, then refreshes after file restart", async (t) => {
  const { service, options, requests, state, complete, directory, protection } = await fixture(t);
  const start = await service.beginAuthorization(input);
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://auth.atlassian.com/authorize");
  assert.equal(url.searchParams.get("resource"), resource);
  assert.equal(url.searchParams.get("scope"), scopes.join(" "));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(requests.length, 0);
  assert.equal((await complete(start)).status, "connected");
  const grant = new URLSearchParams(requests.find(({ url }) => url === tokenEndpoint).init.body);
  assert.equal(grant.get("resource"), resource);
  assert.equal(grant.get("client_secret"), "fixture-client-secret");
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
});

test("Atlassian validates assistant ownership and permissions, and cannot reuse attempts after scope edits", async (t) => {
  const { options, service, requests } = await fixture(t);
  const parse = (config) => parseIntegrationConfiguration(JSON.stringify(config), { providers: [atlassianProvider] });
  for (const [field, value] of [["accountMode", "shared"], ["accountMode", "per-user"], ["scopes", ["admin"]], ["scopes", []]]) {
    const config = structuredClone(options.configuration);
    config.integrations.work[field] = value;
    assert.throws(() => parse(config));
  }
  const config = structuredClone(options.configuration);
  config.integrations.work.scopes = atlassianProvider.scopes.map(({ value }) => value);
  assert.deepEqual(parse(config).integrations.work.scopes, config.integrations.work.scopes);
  assert(atlassianProvider.scopes.filter(({ value }) => /^(write:|delete:|manage:)/.test(value)).every(({ recommended }) => !recommended));
  const start = await service.beginAuthorization(input);
  const changed = createConnectionService({ ...options, configuration: config });
  await assert.rejects(changed.completeAuthorization({ ...input, callbackUrl: `${callback}?code=x&state=${new URL(start.authorizationUrl).searchParams.get("state")}` }), { code: "connector_attempt_invalid" });
  assert.equal(requests.length, 0);
});

test("Atlassian authorizes the exact tool and destination site, preserves tool errors and cancels without replay", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await complete(await service.beginAuthorization(input));
  const count = requests.length;
  for (const payload of [{ name: "deleteJiraIssue", arguments: {} }, { name: "getJiraIssue", arguments: { cloudId: "another-site" } }]) {
    await assert.rejects(service.invoke({ ...input, operation: "tools.call", input: payload }), { code: "connector_access_denied" });
  }
  await assert.rejects(service.invoke({ ...input, operation: "tools.list", input: { url: "https://unexpected.invalid" } }), { code: "connector_input_invalid" });
  assert.equal(requests.length, count);
  const payload = { name: "getJiraIssue", arguments: { cloudId: "allowed-site" } };
  for (const [name, text] of [["getJiraIssue", "DOG-42: Grooming booking fails. Status: In Progress. Assignee: Sam."],
    ["getConfluencePage", "Booking runbook: restart the worker, then verify the pending appointment queue."]]) {
    state.call = { content: [{ type: "text", text }] };
    const request = { name, arguments: { cloudId: "allowed-site" } };
    assert.deepEqual(await service.invoke({ ...input, operation: "tools.call", input: request }), state.call);
    assert.deepEqual(requests.findLast(({ message }) => message?.method === "tools/call").message.params, request);
  }
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
  assert.equal(requests.filter(({ message }) => message?.method === "tools/call").length, 4);
  assert.equal(requests.at(-1).init.method, "DELETE");
});

test("Atlassian declined consent and malformed discovery do not persist a connection", async (t) => {
  const { service, complete, requests, state } = await fixture(t);
  await assert.rejects(complete(await service.beginAuthorization(input), "error=access_denied"), { code: "connector_consent_denied" });
  assert.equal(requests.length, 0);
  state.list = { wrong: [] };
  await assert.rejects(complete(await service.beginAuthorization(input)), { code: "connector_provider_failed" });
  assert.equal((await service.status(input)).status, "disconnected");
});

test("Atlassian preserves the provider's reduced grant and permits empty discovery without claiming product access", async (t) => {
  const { service, complete, state, requests } = await fixture(t);
  state.scopes = ["read:me"];
  state.list = { tools: [] };
  const connected = await complete(await service.beginAuthorization(input));
  assert.deepEqual(connected.grantedScopes, ["read:me"]);
  assert.deepEqual(await service.invoke({ ...input, operation: "tools.list" }), { tools: [] });
  assert(!requests.some(({ message }) => message?.method === "tools/call"));
});

test("Atlassian sanitizes HTTP/refresh failures, persists reconnect status and never follows injected auth metadata", async (t) => {
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

test("Atlassian explicit registration uses its v2 issuer's DCR endpoint and preserves requested product permissions", async () => {
  const requests = [];
  const result = await registerAtlassianClient({ clientName: "My assistant", callbackUrl: callback, scopes }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ ...JSON.parse(init.body), client_id: "created-client", client_secret: "created-secret", client_secret_expires_at: 0 });
    }
  });
  assert.deepEqual(result, { clientId: "created-client", clientSecret: "created-secret", clientSecretExpiresAt: 0 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, registrationEndpoint);
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.credentials, "omit");
  assert.deepEqual(JSON.parse(requests[0].init.body), { client_name: "My assistant", redirect_uris: [callback], token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: scopes.join(" ") });
});

test("Atlassian registration rejects invalid inputs and ambiguous responses without automatic replay", async () => {
  const valid = { clientName: "CLI client", callbackUrl: callback, scopes };
  let requests = 0;
  const options = { fetchImpl: async () => { requests++; throw new Error("secret-provider-response"); } };
  for (const fields of [{ callbackUrl: "http://remote.example/callback" }, { callbackUrl: "https://user:secret@example.test/callback" },
    { callbackUrl: "https://example.test/callback?other=1" }, { scopes: [] }, { scopes: ["admin"] }, { scopes: ["read:me", "read:me"] }, { clientName: "" }]) {
    await assert.rejects(registerAtlassianClient({ ...valid, ...fields }, options));
    assert.equal(requests, 0, `Unexpected registration request for ${JSON.stringify(fields)}`);
  }
  assert.equal(requests, 0);
  await assert.rejects(registerAtlassianClient(valid, options), (error) => {
    assert.equal(error.code, "connector_registration_failed");
    assert.equal(error.cause, undefined);
    assert(!error.message.includes("secret-provider-response"));
    return true;
  });
  assert.equal(requests, 1);
  for (const changes of [{ client_secret: undefined }, { token_endpoint_auth_method: "none" }, { redirect_uris: ["https://unexpected.invalid"] }]) {
    await assert.rejects(registerAtlassianClient(valid, { fetchImpl: async (url, init) => Response.json({ ...JSON.parse(init.body),
      client_id: "client", client_secret: "secret", ...changes }) }), { code: "connector_registration_failed" });
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(registerAtlassianClient(valid, { ...options, signal: controller.signal }), { code: "connector_registration_interrupted" });
  assert.equal(requests, 1);
});
