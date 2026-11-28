import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { registerRoutes as registerFastifyRoutes } from "../../kernel/server/http/lib/routeRegistration.js";
import { registerApiErrorHandler } from "../../kernel/server/http/errorHandling.js";
import {
  ASSISTANT_MCP_ACTION_ID,
  createAssistantMcp,
  createAssistantMcpActions,
  registerAssistantMcpRoutes
} from "../src/server/mcp.js";

const schema = (fields = {}) => ({ schema: createSchema(fields), mode: "patch" });
const config = Object.freeze({
  app: { name: "Books" },
  surfaceDefinitions: { admin: { enabled: true, requiresWorkspace: false }, app: { enabled: true, requiresWorkspace: false } },
  assistantMcp: { surfaceId: "admin" }
});

const booksList = Object.freeze({
  id: "demo.books.list",
  version: 1,
  kind: "query",
  channels: ["automation"],
  surfaces: ["admin"],
  permission: { require: "authenticated" },
  input: schema({}),
  output: schema({ count: { type: "integer", required: true } }),
  execute: async (_input, context) => ({ count: Number(context.actor.id) })
});

// The MCP endpoint as an application serves it: its action and route beside one application action, on Fastify,
// with the signed-in user "3" unless `signedIn` is false.
async function mcpApp(t, { appConfig = config, signedIn = true, moreActions = [] } = {}) {
  const app = Fastify();
  t.after(() => app.close());
  const actions = createActionCatalogue();
  const mcp = createAssistantMcp({ actions, config: appConfig });
  actions.register({ contributorId: "test.books", domain: "demo", actions: [booksList, ...moreActions] });
  actions.register({ contributorId: "test.mcp", domain: "assistant", actions: createAssistantMcpActions({ mcp }) });
  if (signedIn) {
    actions.registerContextContributor({ id: "test.actor", contribute: () => ({ actor: { id: "3" } }) });
    // Where auth-core's plugin puts the user a service key acts as.
    app.addHook("preValidation", async (request) => {
      request.user = { id: "3", providerUserId: "3" };
    });
  }
  const router = createRouter();
  registerAssistantMcpRoutes(router, { mcp });
  registerApiErrorHandler(app);
  registerFastifyRoutes(app, { routes: router.list(), actions });
  return app;
}

const post = (app, body) => app.inject({ method: "POST", url: "/api/mcp", headers: { "content-type": "application/json" }, payload: body });

test("the MCP endpoint answers JSON-RPC over HTTP POST with the signed-in person's tools", async (t) => {
  const app = await mcpApp(t);
  const initialized = await post(app, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(initialized.statusCode, 200, initialized.body);
  assert.match(initialized.headers["content-type"], /^application\/json/u);
  assert.deepEqual(initialized.json().result.serverInfo, { name: "Books", version: "1" });

  const listed = await post(app, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(listed.json().result.tools.map((tool) => tool.name), ["demo_books_list"], "the endpoint's own action is no tool");

  const called = await post(app, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "demo_books_list", arguments: {} } });
  assert.deepEqual(called.json().result, { content: [{ type: "text", text: "{\"count\":3}" }], isError: false });
  assert.equal(called.headers["acting-as-user"], "3", "the caller learns who it acted as");

  const notified = await post(app, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(notified.statusCode, 202);
  assert.equal(notified.body, "");
});

test("the MCP endpoint keeps no stream open and refuses a person nobody signed in", async (t) => {
  const app = await mcpApp(t);
  for (const method of ["GET", "DELETE"]) {
    const response = await app.inject({ method, url: "/api/mcp" });
    assert.equal(response.statusCode, 405, method);
    assert.equal(response.headers.allow, "POST");
  }
  const stranger = await mcpApp(t, { signedIn: false });
  const refused = await post(stranger, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(refused.statusCode, 401, refused.body);
});

test("an application without assistantMcp has no endpoint, and one naming an unknown surface fails at start", () => {
  const actions = createActionCatalogue();
  assert.equal(createAssistantMcp({ actions, config: { surfaceDefinitions: config.surfaceDefinitions } }), null);
  assert.deepEqual(createAssistantMcpActions({ mcp: null }), []);
  assert.throws(
    () => createAssistantMcp({ actions, config: { ...config, assistantMcp: { surfaceId: "nowhere" } } }),
    /assistantMcp.surfaceId "nowhere" is not one of the application's surfaces/u
  );
  assert.throws(
    () => createAssistantMcp({ actions, config: { ...config, surfaceDefinitions: { admin: { requiresWorkspace: true } } } }),
    /workspace/u,
    "a workspace surface needs the workspaces feature's route scope"
  );
});

test("the endpoint's action runs on the configured surface only and is never a tool", async () => {
  const actions = createActionCatalogue();
  const mcp = createAssistantMcp({ actions, config });
  const [definition] = createAssistantMcpActions({ mcp });
  assert.equal(definition.id, ASSISTANT_MCP_ACTION_ID);
  assert.deepEqual(definition.surfaces, ["admin"]);
  assert.deepEqual(definition.channels, ["api"]);
  assert.deepEqual(definition.permission, { require: "authenticated" });
});

test("the endpoint signs in by a service key alone, answers GET and DELETE without one, and takes a rate limit", () => {
  const routesOf = (appConfig) => {
    const router = createRouter();
    registerAssistantMcpRoutes(router, { mcp: createAssistantMcp({ actions: createActionCatalogue(), config: appConfig }) });
    return new Map(router.list().map((route) => [route.method, route]));
  };
  const routes = routesOf(config);
  assert.equal(routes.get("POST").auth, "required");
  assert.equal(routes.get("POST").config.credentials, "bearer", "a browser's cookies never sign it in");
  assert.equal(routes.get("POST").rateLimit, null);
  for (const method of ["GET", "DELETE"]) assert.equal(routes.get(method).auth, "public", method);
  const limited = routesOf({ ...config, assistantMcp: { surfaceId: "admin", rateLimit: { max: 120, timeWindow: "1 minute" } } });
  assert.deepEqual(limited.get("POST").rateLimit, { max: 120, timeWindowMs: 60_000 });
});

test("the endpoint never offers the actions that change how a person signs in, which a key's caller may not manage", async (t) => {
  const signInAction = (id) => ({
    ...booksList,
    id,
    kind: "command",
    permission: { require: "authenticated" },
    output: schema({ ok: { type: "boolean", required: true } }),
    execute: async () => ({ ok: true })
  });
  const app = await mcpApp(t, {
    moreActions: [
      signInAction("auth.logout"),
      signInAction("settings.security.sessions.logout_others"),
      signInAction("settings.security.password_method.toggle"),
      signInAction("settings.security.oauth.unlink"),
      signInAction("settings.preferences.update")
    ]
  });
  const listed = await post(app, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.deepEqual(listed.json().result.tools.map((tool) => tool.name).sort(), ["demo_books_list", "settings_preferences_update"],
    "the person's other settings stay tools");
  const called = await post(app, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "settings_security_sessions_logout_others", arguments: {} } });
  assert.match(called.json().error.message, /Unknown tool/u);
});
