import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnectionService } from "../../connectors-core/src/server/index.js";
import { createFileConnectionStore, createCredentialProtection } from "../../connectors-core/src/server/fileStorage.js";
import { linearProvider } from "../src/server/linear.js";

for (const perUser of [false, true]) test(`Linear OAuth ${perUser ? "per-user" : "shared rotating"} grants preserve protocol and ownership`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "linear-oauth-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const callback = "https://example.test/integrations/linear/callback";
  const context = { applicationId: "app", subjectId: "owner" };
  const input = { context, integrationId: "linear" };
  let time = Date.now(), exchanges = 0;
  let tokenScope = "read write";
  const toolCalls = [];
  // Controlled fixture schemas, not a claim about Linear's current tool names.
  const tools = ["fixture_create_project", "fixture_save_issue"].map(name => ({ name,
    inputSchema: { type: "object", properties: { projectId: { type: "string" } }, additionalProperties: true } }));
  const protection = createCredentialProtection({ keys: { current: new Uint8Array(32).fill(4) }, activeKeyId: "current" });
  const options = {
    configuration: { schemaVersion: 1, registrations: { linear: { source: "own", clientId: "client", clientSecretRef: "env:SECRET", callbackUrlRef: "env:CALLBACK", tokenEndpointAuthMethod: "client_secret_post" } }, integrations: {
      linear: { provider: "linear", accountMode: perUser ? "per-user" : "shared", scopes: ["read", "write"], authentication: { method: "oauth2", registrationRef: "linear" } },
      personal: { provider: "linear", accountMode: "shared", scopes: ["read", "write"], authentication: { method: "api-key", secretRef: "env:TOKEN" } }
    } }, providers: [linearProvider], authorize: async owner => owner,
    store: createFileConnectionStore({ directory, protection }), now: () => time,
    resolveReference: async ref => ref === "env:CALLBACK" ? callback : ref === "env:TOKEN" ? "personal" : "secret",
    fetchImpl: async (address, init) => {
      const url = new URL(String(address)), headers = new Headers(init.headers);
      if (url.pathname === "/oauth/token") {
        assert.equal(url.origin, "https://api.linear.app");
        assert.equal(headers.get("accept"), "application/json");
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("client_secret"), "secret");
        if (body.get("grant_type") === "authorization_code") {
          assert.equal(body.get("redirect_uri"), callback);
          assert.ok(body.get("code_verifier"));
        } else {
          assert.equal(body.get("refresh_token"), `refresh-${exchanges}`);
          assert.equal(body.has("redirect_uri"), false);
        }
        exchanges++;
        return Response.json({ access_token: `access-${exchanges}`, refresh_token: `refresh-${exchanges}`, token_type: "Bearer", expires_in: 60, scope: tokenScope });
      }
      if (url.origin === "https://mcp.linear.app") {
        assert.equal(url.pathname, "/mcp");
        assert.ok(headers.get("authorization") === `Bearer access-${exchanges}` || headers.get("authorization") === "Bearer personal");
        if (init.method === "DELETE") return new Response(null, { status: 204 });
        if (init.method === "GET") return new Response(null, { status: 405 });
        const message = JSON.parse(init.body);
        if (message.id === undefined) return new Response(null, { status: 202 });
        assert.ok(["initialize", "tools/list", "tools/call"].includes(message.method));
        const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion,
          capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } } : message.method === "tools/list" ? { tools } : {
            content: [{ type: "text", text: JSON.stringify({ id: message.params.name === "fixture_create_project" ? "project-1" : "issue-1", ...message.params.arguments }) }],
            isError: message.params.arguments.fail === true
          };
        if (message.method === "tools/call") toolCalls.push(message.params);
        return Response.json({ jsonrpc: "2.0", id: message.id, result });
      }
      assert.equal(url.origin, "https://api.linear.app");
      assert.equal(url.pathname, "/graphql");
      assert.ok(headers.get("authorization") === `Bearer access-${exchanges}` || headers.get("authorization") === "personal");
      return Response.json({ data: { viewer: { id: "123", name: "Fixture" } } });
    }
  };
  const service = createConnectionService(options);
  for (const outcome of ["cancel", "denied"]) {
    const attempt = new URL((await service.beginAuthorization(input)).authorizationUrl);
    const denied = new URL(callback);
    denied.searchParams.set("state", attempt.searchParams.get("state"));
    if (outcome === "cancel") {
      await service.cancelAuthorization({ ...input, state: attempt.searchParams.get("state") });
      denied.searchParams.set("code", "unused");
    } else denied.searchParams.set("error", "access_denied");
    await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: denied.href }), {
      code: outcome === "cancel" ? "connector_attempt_invalid" : "connector_consent_denied"
    });
  }
  assert.equal(exchanges, 0);
  const { authorizationUrl } = await service.beginAuthorization(input);
  const url = new URL(authorizationUrl);
  assert.equal(url.origin + url.pathname, "https://linear.app/oauth/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("actor"), "user");
  assert.equal(url.searchParams.get("scope"), "read,write");
  const returned = new URL(callback);
  returned.searchParams.set("code", "code");
  returned.searchParams.set("state", url.searchParams.get("state"));
  assert.equal((await service.completeAuthorization({ ...input, callbackUrl: returned.href })).status, "connected");
  await assert.rejects(service.completeAuthorization({ ...input, callbackUrl: returned.href }), { code: "connector_attempt_invalid" });
  time += 40_000;
  await Promise.all([service.invoke({ ...input, operation: "profile.read" }), service.invoke({ ...input, operation: "profile.read" })]);
  assert.equal(exchanges, 2);
  const restarted = createConnectionService({ ...options, store: createFileConnectionStore({ directory, protection }) });
  time += 40_000;
  await restarted.invoke({ ...input, operation: "profile.read" });
  assert.equal(exchanges, 3);
  assert.equal((await restarted.connectApiKey({ context, integrationId: "personal" })).status, "connected");
  assert.deepEqual(await restarted.invoke({ ...input, operation: "tools.list" }), { tools });
  assert.deepEqual(await restarted.invoke({ context, integrationId: "personal", operation: "tools.list" }), { tools });
  for (const integrationId of ["linear", "personal"]) {
    const call = (name, args) => restarted.invoke({ context, integrationId, operation: "tools.call", input: { name, arguments: args } });
    const project = await call("fixture_create_project", { name: "Release", teamId: "team-1" });
    assert.equal(JSON.parse(project.content[0].text).id, "project-1");
    const issue = await call("fixture_save_issue", { projectId: "project-1", title: "Ship" });
    assert.equal(JSON.parse(issue.content[0].text).id, "issue-1");
    await call("fixture_save_issue", { projectId: "project-1", id: "issue-1", title: "Ship today" });
    assert.deepEqual(toolCalls.at(-1).arguments, { projectId: "project-1", id: "issue-1", title: "Ship today" });
    assert.equal((await call("fixture_save_issue", { fail: true })).isError, true);
  }
  const guarded = createConnectionService({ ...options, authorize: async (owner, request) =>
    request.operation === "tools.call" && (request.input.name !== "fixture_save_issue" || request.input.arguments.projectId !== "project-1") ? null : owner });
  const beforeDenied = toolCalls.length;
  for (const args of [{ name: "fixture_create_project", arguments: {} }, { name: "fixture_save_issue", arguments: { projectId: "foreign" } }]) {
    await assert.rejects(guarded.invoke({ ...input, operation: "tools.call", input: args }), { code: "connector_access_denied" });
  }
  assert.equal(toolCalls.length, beforeDenied);
  const otherApp = { context: { ...context, applicationId: "another-app" }, integrationId: "linear" };
  assert.equal((await restarted.status(otherApp)).status, "disconnected");
  if (perUser) {
    const otherUser = { context: { ...context, subjectId: "another-user" }, integrationId: "linear" };
    assert.equal((await restarted.status(otherUser)).status, "disconnected");
    await assert.rejects(restarted.invoke({ ...otherUser, operation: "profile.read" }));
    assert.equal((await restarted.status(input)).status, "connected");
  }
  tokenScope = "write";
  time += 40_000;
  await assert.rejects(restarted.invoke({ ...input, operation: "profile.read" }), { code: "connector_scope_missing" });
  await restarted.disconnect(input);
  assert.equal((await restarted.status(input)).status, "disconnected");
});

test("Linear rejects malformed permission grants and preserves OAuth errors", async () => {
  for (const scope of [undefined, 42, [42], ["bad scope"], "read,write"]) {
    await assert.rejects(linearProvider.normalizeTokenResponse(Response.json({ access_token: "secret", scope })), { code: "connector_response_invalid" });
  }
  for (const scope of ["read write", ["read", "write"]]) {
    const response = await linearProvider.normalizeTokenResponse(Response.json({ scope }));
    assert.equal((await response.json()).scope, "read,write");
  }
  const failure = Response.json({ error: "invalid_grant" }, { status: 400 });
  assert.equal(await linearProvider.normalizeTokenResponse(failure), failure);
});
