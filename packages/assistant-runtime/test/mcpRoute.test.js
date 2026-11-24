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
async function mcpApp(t, { appConfig = config, signedIn = true } = {}) {
  const app = Fastify();
  t.after(() => app.close());
  const actions = createActionCatalogue();
  const mcp = createAssistantMcp({ actions, config: appConfig });
  actions.register({ contributorId: "test.books", domain: "demo", actions: [booksList] });
  actions.register({ contributorId: "test.mcp", domain: "assistant", actions: createAssistantMcpActions({ mcp }) });
  if (signedIn) actions.registerContextContributor({ id: "test.actor", contribute: () => ({ actor: { id: "3" } }) });
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

