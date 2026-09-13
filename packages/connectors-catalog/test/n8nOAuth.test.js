import test from "node:test";
import assert from "node:assert/strict";
import { n8nProvider, discoverN8nOAuth, registerN8nClient } from "../src/server/n8n.js";

function fixture(resource, issuer) {
  const calls = [];
  const base = issuer.replace(/\/$/u, "");
  const metadata = {
    issuer, authorization_endpoint: `${base}/mcp-oauth/authorize`,
    token_endpoint: `${base}/mcp-oauth/token`, registration_endpoint: `${base}/mcp-oauth/register`,
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["client_secret_post"], code_challenge_methods_supported: ["S256"],
    scopes_supported: ["workflow:read", "workflow:execute"]
  };
  const protectedResource = { resource, authorization_servers: [issuer], scopes_supported: ["workflow:read"] };
  return { calls, metadata, protectedResource, fetchImpl: async (address, options) => {
    calls.push({ address, options });
    const url = new URL(address);
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.equal(new Headers(options.headers).has("authorization"), false);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return Response.json(protectedResource);
    return Response.json(metadata);
  } };
}

test("n8n OAuth discovery preserves separate authority and resource hosts and installation paths", async () => {
  for (const [resource, issuer] of [
    ["https://automation.example/mcp-server/http", "https://automation.example"],
    ["https://tools.example:8443/team/mcp-server/http", "https://login.example/n8n"]
  ]) {
    const f = fixture(resource, issuer);
    const result = await discoverN8nOAuth({ serverUrl: resource }, f);
    assert.equal(result.resource, resource); assert.deepEqual(result.oauth, f.metadata);
    assert.deepEqual(result.scopes, ["workflow:read"]);
    assert.equal(f.calls[0].address, `${new URL(resource).origin}/.well-known/oauth-protected-resource${new URL(resource).pathname}`);
    assert.equal(f.calls[1].address, `${new URL(issuer).origin}/.well-known/oauth-authorization-server${new URL(issuer).pathname === "/" ? "" : new URL(issuer).pathname}`);
    assert.equal(f.calls.length, 2);
  }
});

test("n8n OAuth discovery rejects mismatched resources, authorities, endpoints and unsupported consent contracts", async () => {
  for (const mutate of [
    (f) => { f.protectedResource.resource += "/other"; },
    (f) => { f.protectedResource.authorization_servers.push("https://other.example"); },
    (f) => { f.protectedResource.authorization_servers = ["http://insecure.example"]; },
    (f) => { f.metadata.issuer = "https://other.example"; },
    (f) => { f.metadata.token_endpoint = "https://other.example/steal"; },
    (f) => { f.metadata.registration_endpoint += "?secret=private"; },
    (f) => { f.metadata.code_challenge_methods_supported = ["plain"]; },
    (f) => { f.metadata.token_endpoint_auth_methods_supported = ["none"]; },
    (f) => { f.protectedResource.scopes_supported = ["invented:scope"]; },
    (f) => { f.protectedResource.scopes_supported = []; }
  ]) {
    const f = fixture("https://tools.example/mcp-server/http", "https://login.example"); mutate(f);
    await assert.rejects(discoverN8nOAuth({ serverUrl: "https://tools.example/mcp-server/http" }, f), { code: "connector_discovery_failed" });
    assert.ok(f.calls.length <= 2);
  }
});

test("n8n OAuth discovery validates input before transport and sanitizes interruption and server errors", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("private-server-detail"); };
  await assert.rejects(discoverN8nOAuth({ serverUrl: "http://bad.example/api" }, { fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(discoverN8nOAuth({ serverUrl: "https://tools.example/mcp-server/http" }, { fetchImpl }), (e) => e.code === "connector_discovery_failed" && !e.message.includes("private-server-detail"));
  const controller = new AbortController(); controller.abort();
  const previous = calls;
  await assert.rejects(discoverN8nOAuth({ serverUrl: "https://tools.example/mcp-server/http" }, { fetchImpl, signal: controller.signal }), { code: "connector_discovery_interrupted" });
  assert.equal(calls, previous);
});


test("n8n registers once with discovered authority, exact callback and selected resource scopes", async () => {
  const f = fixture("https://tools.example/team/mcp-server/http", "https://login.example/n8n");
  let registrations = 0;
  const callback = "https://app.example/integrations/n8n/callback";
  const result = await registerN8nClient({ serverUrl: f.protectedResource.resource, clientName: "App assistant", callbackUrl: callback, scopes: ["workflow:read"] }, {
    fetchImpl: async (url, options) => {
      if (options.method !== "POST") return f.fetchImpl(url, options);
      registrations++;
      assert.equal(String(url), f.metadata.registration_endpoint);
      assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
      const body = JSON.parse(options.body);
      assert.deepEqual(body.redirect_uris, [callback]);
      assert.equal(body.scope, "workflow:read"); assert.equal(body.token_endpoint_auth_method, "client_secret_post");
      return Response.json({ ...body, client_id: "fixture-client", client_secret: "fixture-secret", client_secret_expires_at: 2000000000 });
    }
  });
  assert.equal(registrations, 1); assert.deepEqual(result.requestedScopes, ["workflow:read"]); assert.equal(result.clientId, "fixture-client");
  assert.equal(result.clientSecret, "fixture-secret"); assert.equal(result.clientSecretExpiresAt, 2000000000);
  assert.equal(result.resource, f.protectedResource.resource); assert.deepEqual(result.oauth, f.metadata);
});

test("n8n rejects unsupported registration scopes before POST and never retries an ambiguous registration", async () => {
  const f = fixture("https://tools.example/mcp-server/http", "https://login.example");
  const input = { serverUrl: f.protectedResource.resource, clientName: "App", callbackUrl: "https://app.example/callback", scopes: ["workflow:execute"] };
  let posts = 0;
  const options = { fetchImpl: async (url, request) => {
    if (request.method !== "POST") return f.fetchImpl(url, request);
    posts++; throw new Error("private-instance-error");
  } };
  await assert.rejects(registerN8nClient(input, options), { code: "connector_scope_unavailable" });
  assert.equal(posts, 0);
  await assert.rejects(registerN8nClient({ ...input, scopes: ["workflow:read"] }, options), (e) => e.code === "connector_registration_failed" && !e.message.includes("private-instance-error"));
  assert.equal(posts, 1);
  const previous = f.calls.length;
  await assert.rejects(registerN8nClient({ ...input, callbackUrl: "https://app.example/callback?secret=value" }, options));
  assert.equal(f.calls.length, previous); assert.equal(posts, 1);
});


test("n8n saved discovery drives project-owned consent, encrypted grants and refresh without rediscovery", async (t) => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createConnectionService } = await import("../../connectors-core/src/server/index.js");
  const { createFileConnectionStore, createCredentialProtection } = await import("../../connectors-core/src/server/fileStorage.js");
  const f = fixture("https://tools.example/team/mcp-server/http", "https://login.example/n8n");
  const discovery = await discoverN8nOAuth({ serverUrl: f.protectedResource.resource }, f);
  const directory = await mkdtemp(join(tmpdir(), "n8n-oauth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(3) }, activeKeyId: "current" });
  const callback = "https://app.example/integrations/n8n/callback";
  const input = { context: { applicationId: "app", subjectId: "owner" }, integrationId: "automation" };
  const requests = [];
  let now = Date.now();
  const options = {
    configuration: { schemaVersion: 1, registrations: { client: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:N8N_CLIENT_SECRET", callbackUrlRef: "env:N8N_CALLBACK_URL" } }, integrations: {
      automation: { provider: "n8n", accountMode: "assistant", scopes: ["workflow:read"],
        settings: { serverUrl: discovery.resource, oauthDiscovery: discovery },
        authentication: { method: "oauth2", registrationRef: "client" } }
    } }, providers: [n8nProvider], store: createFileConnectionStore({ directory, protection }), now: () => now,
    authorize: async (owner) => owner,
    resolveReference: async (ref) => ref === "env:N8N_CLIENT_SECRET" ? "fixture-secret" : callback,
    fetchImpl: async (address, init) => {
      requests.push({ address: String(address), init });
      if (String(address) === discovery.oauth.token_endpoint) {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("resource"), discovery.resource);
        assert.equal(body.get("client_secret"), "fixture-secret");
        const refresh = body.get("grant_type") === "refresh_token";
        if (refresh) assert.equal(body.get("refresh_token"), "initial-refresh");
        else { assert.equal(body.get("redirect_uri"), callback); assert.ok(body.get("code_verifier")); }
        return Response.json({ token_type: "Bearer", access_token: refresh ? "renewed" : "initial", refresh_token: "initial-refresh",
          expires_in: 60, scope: "workflow:read" });
      }
      assert.equal(String(address), discovery.resource);
      assert.equal(new Headers(init.headers).get("authorization"), now > startedAt ? "Bearer renewed" : "Bearer initial");
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      const message = JSON.parse(init.body);
      if (message.id === undefined) return new Response(null, { status: 202 });
      assert.ok(["initialize", "tools/list"].includes(message.method));
      return Response.json({ jsonrpc: "2.0", id: message.id, result: message.method === "initialize" ? {
        protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "n8n", version: "1" }
      } : { tools: [] } });
    }
  };
  const startedAt = now;
  const service = createConnectionService(options);
  const start = await service.beginAuthorization(input);
  const authorization = new URL(start.authorizationUrl);
  assert.equal(authorization.origin + authorization.pathname, discovery.oauth.authorization_endpoint);
  assert.equal(authorization.searchParams.get("resource"), discovery.resource);
  assert.equal(authorization.searchParams.get("scope"), "workflow:read");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(requests.length, 0);
  assert.equal((await service.completeAuthorization({ ...input,
    callbackUrl: `${callback}?code=fixture&state=${authorization.searchParams.get("state")}&iss=${encodeURIComponent(discovery.oauth.issuer)}` })).status, "connected");
  now += 61_000;
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: {} }), { tools: [] });
  assert.equal(requests.filter((request) => request.address === discovery.oauth.token_endpoint).length, 2);
  const changed = structuredClone(options.configuration);
  changed.integrations.automation.settings.serverUrl = "https://other.example/mcp-server/http";
  const count = requests.length;
  await assert.rejects(createConnectionService({ ...options, configuration: changed }).beginAuthorization(input), { code: "connector_discovery_required" });
  assert.equal(requests.length, count);
  for (const mutation of [
    (d) => { d.oauth.token_endpoint = "https://other.example/token"; },
    (d) => { d.scopes = ["unknown:scope"]; },
    (d) => { d.scopes = ["workflow:read", "workflow:read"]; }
  ]) {
    const invalid = structuredClone(options.configuration); mutation(invalid.integrations.automation.settings.oauthDiscovery);
    assert.throws(() => createConnectionService({ ...options, configuration: invalid }));
  }
});
