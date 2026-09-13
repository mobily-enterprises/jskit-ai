import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { heygenProvider, registerHeyGenClient } from "../src/server/heygen.js";

const context = { applicationId: "app-one", subjectId: "owner-one" };
const args = { context, integrationId: "meetings" };
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "heygen-oauth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const options = {
    configuration: { schemaVersion: 1, registrations: {}, integrations: { meetings: {
      provider: "heygen", accountMode: "shared", scopes: [], authentication: { method: "api-key", secretRef: "env:HEYGEN_KEY" }
    } } },
    providers: [heygenProvider], authorize: async (owner) => owner,
    resolveReference: async () => "fixture-api-key",
    store: createFileConnectionStore({ directory, protection: createCredentialProtection({ keys: { current: new Uint8Array(32).fill(7) }, activeKeyId: "current" }) }),
    fetchImpl: async (url, init) => {
      requests.push(String(url));
      assert.equal(String(url), "https://api.heygen.com/v3/users/me");
      assert.equal(new Headers(init.headers).get("x-api-key"), "fixture-api-key");
      return Response.json({ data: { username: "fixture" } });
    }
  };
  const service = createConnectionService(options);
  return { service, options, requests, connect: () => service.connectApiKey(args) };
}

test("HeyGen MCP OAuth verifies tools, refreshes after restart and cannot call API-key operations", async (t) => {
  const f = await fixture(t);
  const callback = "http://127.0.0.1:4930/heygen/callback";
  const calls = []; let time = Date.now();
  const scopes = ["openid", "profile", "email"];
  const tools = [
    { name: "create_video_agent", description: "Controlled creation fixture", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"] } },
    { name: "get_video_agent_session", description: "Controlled status fixture", inputSchema: { type: "object", properties: { session_id: { type: "string" } }, required: ["session_id"] } }
  ];
  const options = { ...f.options, now: () => time,
    authorize: async (owner, request) => request.operation === "tools.call" && ![
      "create_video_agent", "get_video_agent_session"
    ].includes(request.input.name) ? null : owner,
    configuration: { schemaVersion: 1, registrations: { heygen: { source: "own", clientId: "fixture-client",
      clientSecretRef: "env:HEYGEN_SECRET", callbackUrlRef: "env:HEYGEN_CALLBACK" } }, integrations: {
      meetings: { provider: "heygen", accountMode: "assistant", scopes, authentication: { method: "oauth2", registrationRef: "heygen" } }
    } }, resolveReference: async (ref) => ref === "env:HEYGEN_SECRET" ? "fixture-secret" : callback,
    fetchImpl: async (address, init) => {
      const url = String(address); calls.push({ url, init });
      if (url === "https://api2.heygen.com/v1/oauth/token") {
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "fixture-secret");
        assert.equal(body.get("resource"), "https://mcp.heygen.com");
        const refresh = body.get("grant_type") === "refresh_token";
        if (refresh) assert.equal(body.get("refresh_token"), "fixture-refresh");
        else { assert(body.get("code_verifier")); assert.equal(body.get("redirect_uri"), callback); }
        return Response.json({ access_token: refresh ? "refreshed-access" : "fixture-access", refresh_token: "fixture-refresh",
          token_type: "Bearer", expires_in: 60, scope: scopes.join(" ") });
      }
      assert.equal(url, "https://mcp.heygen.com/mcp/v1/");
      assert.match(new Headers(init.headers).get("authorization"), /^Bearer (fixture-access|refreshed-access)$/u);
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      if (init.method === "GET") return new Response(null, { status: 405 });
      const message = JSON.parse(init.body); calls.at(-1).message = message;
      if (message.id === undefined) return new Response(null, { status: 202 });
      const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } :
        message.method === "tools/list" ? { tools } : { content: [{ type: "text", text: JSON.stringify(
          message.params.name === "create_video_agent" ? { session_id: "fixture-session", status: "pending" } :
          { session_id: "fixture-session", status: "completed", video_url: "https://media.example/fixture.mp4" }
        ) }] };
      return Response.json({ jsonrpc: "2.0", id: message.id, result });
    }
  };
  const service = createConnectionService(options);
  const start = await service.beginAuthorization(args); const url = new URL(start.authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://api2.heygen.com/v1/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const completion = { ...args, callbackUrl: `${callback}?state=${url.searchParams.get("state")}&code=fixture` };
  assert.equal((await service.completeAuthorization(completion)).status, "connected");
  assert.equal(calls.some((call) => call.message?.method === "tools/call"), false);
  const before = calls.length;
  await assert.rejects(service.invoke({ ...args, operation: "profile.read" }), { code: "connector_mode_unavailable" });
  assert.equal(calls.length, before);
  await assert.rejects(service.completeAuthorization(completion));
  time += 61000;
  const restarted = createConnectionService(options);
  assert.deepEqual(await restarted.invoke({ ...args, operation: "tools.list" }), { tools });
  assert.equal(calls.filter((call) => call.url.endsWith("/token")).length, 2);
  const creation = await restarted.invoke({ ...args, operation: "tools.call", input: { name: "create_video_agent", arguments: { prompt: "A booking reminder" } } });
  assert.equal(JSON.parse(creation.content[0].text).session_id, "fixture-session");
  assert.deepEqual(calls.filter(call => call.message?.method === "tools/call").at(-1).message.params,
    { name: "create_video_agent", arguments: { prompt: "A booking reminder" } });
  const status = await restarted.invoke({ ...args, operation: "tools.call", input: { name: "get_video_agent_session", arguments: { session_id: "fixture-session" } } });
  assert.equal(JSON.parse(status.content[0].text).status, "completed");
  const beforeDenied = calls.length;
  await assert.rejects(restarted.invoke({ ...args, operation: "tools.call", input: { name: "delete_video", arguments: { video_id: "other-user" } } }));
  assert.equal(calls.length, beforeDenied);
  await restarted.disconnect(args); assert.equal((await restarted.status(args)).status, "disconnected");
  const key = await fixture(t); await key.connect(); const keyRequests = key.requests.length;
  await assert.rejects(key.service.invoke({ ...args, operation: "tools.list" }), { code: "connector_mode_unavailable" });
  assert.equal(key.requests.length, keyRequests);
});

test("HeyGen registers the host callback through the existing MCP registration contract", async () => {
  const requests = [];
  const result = await registerHeyGenClient({ clientName: "Fixture host", callbackUrl: "https://app.example/integrations/heygen/callback" }, {
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return Response.json({ ...JSON.parse(init.body), client_id: "client", client_secret: "secret" });
    }
  });
  assert.deepEqual(result, { clientId: "client", clientSecret: "secret" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api2.heygen.com/v1/oauth/register");
  assert.deepEqual(requests[0].body.redirect_uris, ["https://app.example/integrations/heygen/callback"]);
  assert.equal(requests[0].body.token_endpoint_auth_method, "client_secret_post");
});
