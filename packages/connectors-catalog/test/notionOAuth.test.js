import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notionProvider, registerNotionMcpClient } from "../src/server/notion.js";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";

test("Notion exchanges JSON with Basic auth and persists rotated refresh tokens across restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "notion-oauth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(9) }, activeKeyId: "current" });
  const callback = "https://app.example/integrations/notion/callback";
  const input = { context: { applicationId: "app", subjectId: "alice" }, integrationId: "notes" };
  let now = Date.now();
  let tokenRequests = 0;
  const options = {
    configuration: { schemaVersion: 1, registrations: { notion: { source: "own", clientId: "client-id",
      tokenEndpointAuthMethod: "client_secret_basic", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } },
    integrations: { notes: { provider: "notion", accountMode: "per-user", scopes: [],
      authentication: { method: "oauth2", registrationRef: "notion" } } } },
    providers: [notionProvider], store: createFileConnectionStore({ directory, protection }), now: () => now,
    authorize: async (owner) => owner,
    resolveReference: async (ref) => ref === "env:SECRET" ? "private-secret" : callback,
    fetchImpl: async (address, init) => {
      const headers = new Headers(init.headers);
      if (String(address) === "https://api.notion.com/v1/oauth/token") {
        assert.equal(init.method, "POST"); assert.equal(init.redirect, "manual");
        assert.equal(headers.get("content-type"), "application/json");
        assert.equal(headers.get("authorization"), `Basic ${Buffer.from("client-id:private-secret").toString("base64")}`);
        assert.ok(init.signal instanceof AbortSignal);
        const body = JSON.parse(init.body);
        assert.equal(body.client_secret, undefined); assert.equal(body.code_verifier, undefined);
        if (tokenRequests === 0) assert.deepEqual(body, { grant_type: "authorization_code", code: "fixture", redirect_uri: callback });
        else assert.deepEqual(body, { grant_type: "refresh_token", refresh_token: `refresh-${tokenRequests}` });
        tokenRequests++;
        return Response.json({ token_type: "bearer", access_token: `access-${tokenRequests}`, refresh_token: `refresh-${tokenRequests}`, expires_in: 60 });
      }
      assert.equal(String(address), "https://api.notion.com/v1/search");
      assert.equal(headers.get("notion-version"), "2026-03-11");
      assert.equal(headers.get("authorization"), `Bearer access-${tokenRequests}`);
      return Response.json({ object: "list", results: [], has_more: false });
    }
  };
  const service = createConnectionService(options);
  const start = await service.beginAuthorization(input);
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, notionProvider.oauth.authorization_endpoint);
  assert.equal(url.searchParams.get("owner"), "user");
  assert.equal(url.searchParams.get("redirect_uri"), callback);
  assert.equal(url.searchParams.has("code_challenge"), false);
  assert.equal(tokenRequests, 0);
  const completion = { ...input, callbackUrl: `${callback}?code=fixture&state=${url.searchParams.get("state")}` };
  assert.equal((await service.completeAuthorization(completion)).status, "connected");
  await assert.rejects(service.completeAuthorization(completion));
  assert.equal(tokenRequests, 1);
  for (let i = 0; i < 2; i++) {
    now += 61_000;
    const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
    assert.deepEqual(await restarted.invoke({ ...input, operation: "content.search", input: {} }), { object: "list", results: [], has_more: false });
  }
  assert.equal(tokenRequests, 3);
  await assert.rejects(service.invoke({ ...input, context: { ...input.context, subjectId: "bob" }, operation: "content.search", input: {} }));
  assert.equal(tokenRequests, 3);
});

test("Notion rejects failed or malformed token exchanges without replay or secret disclosure", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "notion-oauth-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(8) }, activeKeyId: "current" });
  const callback = "https://app.example/integrations/notion/callback";
  const input = { context: { applicationId: "app", subjectId: "alice" }, integrationId: "notes" };
  const configuration = { schemaVersion: 1, registrations: { notion: { source: "own", clientId: "client-id",
    tokenEndpointAuthMethod: "client_secret_basic", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } },
    integrations: { notes: { provider: "notion", accountMode: "per-user", scopes: [], authentication: { method: "oauth2", registrationRef: "notion" } } } };
  for (const response of [
    () => Response.json({ error: "invalid_client", error_description: "private-fixture-secret" }, { status: 401 }),
    () => Response.json({ token_type: "bearer", refresh_token: "private-fixture-secret" }),
    () => new Response("private-fixture-secret", { status: 502 }),
    () => { throw new Error("private-fixture-secret"); }
  ]) {
    let requests = 0;
    const service = createConnectionService({ configuration, providers: [notionProvider],
      store: createFileConnectionStore({ directory, protection }), authorize: async (owner) => owner,
      resolveReference: async (ref) => ref === "env:SECRET" ? "private-fixture-secret" : callback,
      fetchImpl: async () => { requests++; return response(); }
    });
    const start = await service.beginAuthorization(input);
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    const completion = { ...input, callbackUrl: `${callback}?code=fixture&state=${state}` };
    await assert.rejects(service.completeAuthorization(completion), (error) => {
      assert.equal(JSON.stringify(error).includes("private-fixture-secret"), false);
      assert.equal(error.message.includes("private-fixture-secret"), false);
      return true;
    });
    assert.equal(requests, 1);
    await assert.rejects(service.completeAuthorization(completion));
    assert.equal(requests, 1);
    await assert.rejects(service.invoke({ ...input, operation: "content.search", input: {} }));
    assert.equal(requests, 1);
  }
});

test("Notion hosted MCP uses separate PKCE/form credentials and tool discovery", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "notion-mcp-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const callback = "https://app.example/integrations/notion/callback";
  const configuration = { schemaVersion: 1, registrations: { client: { source: "own", clientId: "mcp-client",
    clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK" } }, integrations: {
    notes: { provider: "notion", accountMode: "assistant", settings: { connectionType: "mcp" }, scopes: ["default"],
      authentication: { method: "oauth2", registrationRef: "client" } } } };
  const input = { context: { applicationId: "app", subjectId: "alice" }, integrationId: "notes" };
  let exchanges = 0;
  let now = Date.now();
  const options = { now: () => now, configuration, providers: [notionProvider], authorize: async (owner) => owner,
    store: createFileConnectionStore({ directory, protection }),
    resolveReference: async (ref) => ref === "env:SECRET" ? "mcp-secret" : callback,
    fetchImpl: async (address, init) => {
      if (String(address) === "https://mcp.notion.com/token") {
        const body = new URLSearchParams(init.body);
        if (exchanges === 0) assert.ok(body.get("code_verifier"));
        else { assert.equal(body.get("grant_type"), "refresh_token"); assert.equal(body.get("refresh_token"), "mcp-refresh"); }
        assert.equal(body.get("client_secret"), "mcp-secret");
        assert.equal(new Headers(init.headers).has("authorization"), false);
        assert.match(new Headers(init.headers).get("content-type"), /application\/x-www-form-urlencoded/u);
        exchanges++;
        return Response.json({ token_type: "bearer", access_token: "mcp-access", refresh_token: "mcp-refresh", expires_in: 3600, scope: "default" });
      }
      assert.equal(String(address), "https://mcp.notion.com/mcp");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer mcp-access");
      if (init.method === "GET") return new Response(null, { status: 405 });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      const body = JSON.parse(init.body);
      if (body.id === undefined) return new Response(null, { status: 202 });
      assert.ok(["initialize", "tools/list"].includes(body.method));
      return Response.json({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize" ? {
        protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" }
      } : { tools: [] } });
    }
  };
  const service = createConnectionService(options);
  const start = await service.beginAuthorization(input);
  const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://mcp.notion.com/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.has("owner"), false);
  await service.completeAuthorization({ ...input, callbackUrl: `${callback}?code=fixture&state=${url.searchParams.get("state")}` });
  assert.equal(exchanges, 1);
  now += 3_601_000;
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list", input: {} }), { tools: [] });
  assert.equal(exchanges, 2);
  await assert.rejects(service.invoke({ ...input, operation: "content.search", input: {} }));
  const invalid = structuredClone(configuration); invalid.integrations.notes.accountMode = "per-user";
  assert.throws(() => createConnectionService({ ...options, configuration: invalid }));
});


test("Notion MCP client registration validates callback and never retries an ambiguous failure", async () => {
  const input = { clientName: "Notes assistant", callbackUrl: "https://app.example/integrations/notion/callback" };
  let requests = 0;
  const fetchImpl = async (address, options) => {
    requests++;
    assert.equal(String(address), "https://mcp.notion.com/register");
    assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    const body = JSON.parse(options.body);
    assert.equal(body.scope, "default");
    assert.equal(body.token_endpoint_auth_method, "client_secret_post");
    assert.deepEqual(body.redirect_uris, [input.callbackUrl]);
    return Response.json({ ...body, client_id: "mcp-client", client_secret: "private-secret" });
  };
  assert.deepEqual(await registerNotionMcpClient(input, { fetchImpl }), { clientId: "mcp-client", clientSecret: "private-secret" });
  assert.equal(requests, 1);
  await assert.rejects(registerNotionMcpClient({ ...input, callbackUrl: "https://app.example/callback?secret=bad" }, { fetchImpl }));
  assert.equal(requests, 1);
  await assert.rejects(registerNotionMcpClient(input, { fetchImpl: async () => {
    requests++; throw new Error("private-secret");
  } }), (error) => error.code === "connector_registration_failed" && !error.message.includes("private-secret"));
  assert.equal(requests, 2);
});
