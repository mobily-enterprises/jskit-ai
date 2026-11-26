import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { resolveRequest } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes as registerFastifyRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import { authPolicyPlugin } from "../../auth-core/src/server/lib/index.js";
import { createAuthActionContextContributor } from "../../auth-core/src/server/lib/actionContextContributor.js";
import {
  createLocalAuthService,
  createLocalFileBackend,
  createServiceKeyRecord
} from "../../auth-provider-local-core/src/server/lib/index.js";
import { localServiceOptions } from "../../auth-provider-local-core/test-support/localService.js";
import { sessionCookies } from "../../auth-provider-local-core/test-support/oauthHarness.js";
import { createAssistantMcp, createAssistantMcpActions, registerAssistantMcpRoutes } from "../src/server/mcp.js";

// The MCP endpoint as another application's server reaches it: auth-core's policy plugin, local auth with a service
// key, the endpoint and two application actions on one Fastify app. Each call acts as the user it names with exactly
// that user's rights, which the application gives by who the actor is; the key's own service user may do more, and
// none of it reaches a call.

const schema = (fields = {}) => ({ schema: createSchema(fields), mode: "patch" });

async function mcpServer(t) {
  const storeDir = await fs.mkdtemp(path.join(os.tmpdir(), "jskit-mcp-service-keys-"));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    await fs.rm(storeDir, { recursive: true, force: true });
  });
  const backend = createLocalFileBackend({ storeDir });
  const auth = createLocalAuthService({ ...localServiceOptions(), backend });
  const account = async (email) => (await auth.register({ email, password: "correct horse" })).actor;
  const robot = await account("mercbot@example.com");
  const anna = await account("anna@example.com");
  const bob = await account("bob@example.com");
  const { key, record } = createServiceKeyRecord({ userId: robot.providerUserId });
  await backend.withTransaction((tx) => tx.sessions.create(record));

  // The application's rights, by who signed in: the service user may delete, as Bob may; Anna may only list.
  const rights = new Map([
    [String(robot.id), ["books.list", "books.delete"]],
    [String(bob.id), ["books.list", "books.delete"]],
    [String(anna.id), ["books.list"]]
  ]);
  const calls = [];
  const book = (id, kind, permission, extensions = {}) => ({
    id,
    version: 1,
    kind,
    channels: ["automation"],
    surfaces: ["admin"],
    permission: { require: "all", permissions: [permission] },
    input: schema({}),
    output: schema({ ok: { type: "boolean", required: true } }),
    extensions,
    execute: async (_input, context) => {
      calls.push({ id, actor: String(context.actor.id), via: context.actingVia?.name || "" });
      return { ok: true };
    }
  });
  const config = {
    app: { name: "Books" },
    surfaceDefinitions: { admin: { enabled: true, requiresWorkspace: false } },
    assistantMcp: { surfaceId: "admin" }
  };
  const actions = createActionCatalogue();
  const mcp = createAssistantMcp({ actions, config });
  actions.register({
    contributorId: "test.books",
    domain: "demo",
    actions: [
      book("demo.books.list", "query", "books.list"),
      book("demo.books.delete", "command", "books.delete", { assistant: { destructive: true } })
    ]
  });
  actions.register({ contributorId: "test.mcp", domain: "assistant", actions: createAssistantMcpActions({ mcp }) });
  const authContext = createAuthActionContextContributor();
  actions.registerContextContributor({ id: authContext.contributorId, contribute: authContext.contribute });
  actions.registerContextContributor({
    id: "test.rights",
    contribute: ({ context }) => ({ permissions: rights.get(String(resolveRequest(context)?.user?.id)) || [] })
  });

  await authPolicyPlugin({
    resolveActor: (request) => auth.authenticateRequest(request),
    hasPermission: () => true
  }, { appEnv: "test" })(app);
  registerApiErrorHandler(app);
  const router = createRouter();
  registerAssistantMcpRoutes(router, { mcp });
  registerFastifyRoutes(app, { routes: router.list(), actions });

  const rpc = (id, method, params, headers = {}, extra = {}) => app.inject({
    method: "POST",
    url: "/api/mcp",
    headers: { "content-type": "application/json", ...headers },
    payload: { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) },
    ...extra
  });
  const as = (who) => ({ authorization: `Bearer ${key}`, "act-as-user": who });
  return { auth, backend, robot, anna, bob, key, record, calls, rpc, as };
}

const toolNames = (response) => response.json().result.tools.map((tool) => tool.name).sort();

test("a service key's call acts as the user it names with that user's rights, never the key's", async (t) => {
  const { anna, bob, robot, calls, rpc, as } = await mcpServer(t);

  const initialized = await rpc(1, "initialize", { protocolVersion: "2025-11-25" }, as("Anna@Example.com"));
  assert.equal(initialized.statusCode, 200, initialized.body);
  assert.equal(initialized.headers["acting-as-user"], anna.providerUserId, "an email names its user, whose id the caller learns");

  const annasTools = await rpc(2, "tools/list", null, as(anna.providerUserId));
  assert.deepEqual(toolNames(annasTools), ["demo_books_list"], "Anna may not delete, though the key's service user may");
  const refused = await rpc(3, "tools/call", { name: "demo_books_delete", arguments: {} }, as(anna.providerUserId));
  assert.equal(refused.statusCode, 200, refused.body);
  assert.match(refused.json().error.message, /Unknown tool: demo_books_delete/u);
  assert.deepEqual(calls, [], "nothing ran for a tool Anna may not run");

  const listed = await rpc(4, "tools/call", { name: "demo_books_list", arguments: {} }, as(anna.providerUserId));
  assert.equal(listed.json().result.isError, false, listed.body);
  assert.deepEqual(calls.at(-1), { id: "demo.books.list", actor: String(anna.id), via: robot.displayName });

  const bobsTools = await rpc(5, "tools/list", null, as("bob@example.com"));
  assert.deepEqual(toolNames(bobsTools), ["demo_books_delete", "demo_books_list"]);
  const annotations = Object.fromEntries(bobsTools.json().result.tools.map((tool) => [tool.name, tool.annotations]));
  assert.equal(annotations.demo_books_delete.destructiveHint, true);
  assert.equal(annotations.demo_books_list.readOnlyHint, true);
  const deleted = await rpc(6, "tools/call", { name: "demo_books_delete", arguments: {} }, as(bob.providerUserId));
  assert.equal(deleted.json().result.isError, false, deleted.body);
  assert.deepEqual(calls.at(-1), { id: "demo.books.delete", actor: String(bob.id), via: robot.displayName },
    "it ran as Bob, recorded as through the key");
});

test("a call that names no one, the key's own user or a stranger, or comes with a person's sign-in, runs nothing", async (t) => {
  const { auth, robot, key, calls, rpc, as } = await mcpServer(t);
  const deleteCall = { name: "demo_books_delete", arguments: {} };

  const noKey = await rpc(1, "tools/call", deleteCall, { "act-as-user": "bob@example.com" });
  assert.equal(noKey.statusCode, 401);
  assert.equal(noKey.json().code, "auth.serviceKey.required");
  assert.equal(noKey.headers["www-authenticate"], "Bearer");

  const noActAs = await rpc(2, "tools/call", deleteCall, { authorization: `Bearer ${key}` });
  assert.equal(noActAs.statusCode, 400);
  assert.equal(noActAs.json().code, "auth.serviceKey.actAsRequired");
  const self = await rpc(3, "tools/call", deleteCall, as(robot.providerUserId));
  assert.equal(self.statusCode, 403);
  assert.equal(self.json().code, "auth.serviceKey.actAsSelf");
  const stranger = await rpc(4, "tools/call", deleteCall, as("nobody@example.com"));
  assert.equal(stranger.statusCode, 403);
  assert.equal(stranger.json().code, "auth.serviceKey.actAsUnknown");

  const bobsSession = (await auth.login({ email: "bob@example.com", password: "correct horse" })).session;
  const browser = await rpc(5, "tools/call", deleteCall, {}, { cookies: sessionCookies(bobsSession) });
  assert.equal(browser.statusCode, 401, "a browser's cookies never sign in the endpoint");
  const ownToken = await rpc(6, "tools/call", deleteCall, { authorization: `Bearer ${bobsSession.access_token}`, "act-as-user": robot.providerUserId });
  assert.equal(ownToken.statusCode, 403);
  assert.equal(ownToken.json().code, "auth.serviceKey.notServiceKey", "a person's own token acts as no one");
  const keyAsCookie = await rpc(7, "tools/call", deleteCall, {}, { cookies: { jskit_local_refresh_token: key } });
  assert.equal(keyAsCookie.statusCode, 401);

  assert.deepEqual(calls, [], "no refused call ran anything");
});

test("a revoked key stops at its next call", async (t) => {
  const { backend, record, calls, rpc, as } = await mcpServer(t);
  const deleteCall = { name: "demo_books_delete", arguments: {} };
  assert.equal((await rpc(1, "tools/call", deleteCall, as("bob@example.com"))).json().result.isError, false);
  await backend.withTransaction((tx) => tx.sessions.revoke(record.id));
  const revoked = await rpc(2, "tools/call", deleteCall, as("bob@example.com"));
  assert.equal(revoked.statusCode, 401);
  assert.equal(revoked.json().code, "auth.serviceKey.invalid");
  assert.equal(revoked.headers["www-authenticate"], 'Bearer error="invalid_token"');
  assert.equal(calls.length, 1, "nothing ran after the revoke");
});
