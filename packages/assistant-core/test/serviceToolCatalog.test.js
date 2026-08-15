import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "../src/server/lib/serviceToolCatalog.js";

function schema(fields = {}) {
  return { schema: createSchema(fields), mode: "patch" };
}

function createActions(definitions = []) {
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "test.tools",
    domain: "demo",
    actions: definitions
  });
  return actions;
}

function action({
  id = "demo.books.list",
  channels = ["automation"],
  surfaces = ["admin"],
  permission = { require: "authenticated" },
  input = schema({}),
  output = schema({ ok: { type: "boolean", required: true } }),
  extensions = {},
  execute = async () => ({ ok: true })
} = {}) {
  return {
    id,
    version: 1,
    kind: "query",
    channels,
    surfaces,
    permission,
    input,
    output,
    idempotency: "none",
    extensions,
    execute
  };
}

test("assistant tools expose only automation actions allowed for the actor and surface", () => {
  const actions = createActions([
    action(),
    action({
      id: "demo.books.delete",
      permission: { require: "all", permissions: ["books.delete"] }
    }),
    action({ id: "demo.books.internal", channels: ["internal"] }),
    action({ id: "demo.books.other", surfaces: ["app"] })
  ]);
  const catalog = createServiceToolCatalog(actions);

  assert.equal(catalog.resolveToolSet({ surface: "admin" }).tools.length, 0);
  assert.deepEqual(
    catalog.resolveToolSet({ actor: { id: "7" }, surface: "admin" }).tools.map((entry) => entry.actionId),
    ["demo.books.list"]
  );
  assert.deepEqual(
    catalog.resolveToolSet({
      actor: { id: "7" },
      permissions: ["books.delete"],
      surface: "admin"
    }).tools.map((entry) => entry.actionId),
    ["demo.books.delete", "demo.books.list"]
  );
});

test("assistant tools honor barred ids, prefixes, schemas, and explicit descriptions", () => {
  const actions = createActions([
    action({
      id: "demo.books.list",
      input: schema({ search: { type: "string", required: false } }),
      extensions: { assistant: { description: "Search the catalogue." } }
    }),
    action({ id: "demo.books.delete" }),
    action({ id: "system.health.read" })
  ]);
  const catalog = createServiceToolCatalog(actions, {
    barredActionIds: ["demo.books.delete"],
    skipActionPrefixes: ["system."]
  });
  const [tool] = catalog.resolveToolSet({ actor: { id: "7" }, surface: "admin" }).tools;

  assert.equal(tool.actionId, "demo.books.list");
  assert.equal(tool.description, "Search the catalogue.");
  assert.equal(tool.parameters.properties.search.type, "string");
  assert.equal(tool.outputSchema.properties.ok["x-json-rest-schema"].castType, "boolean");
  assert.equal(catalog.toOpenAiToolSchema(tool).function.name, tool.name);
});

test("assistant tools require both input and output contracts", () => {
  const actions = createActions([
    action({ id: "demo.complete" }),
    action({ id: "demo.no-output", output: null })
  ]);
  const tools = createServiceToolCatalog(actions)
    .resolveToolSet({ actor: { id: "7" }, surface: "admin" })
    .tools;

  assert.deepEqual(tools.map((entry) => entry.actionId), ["demo.complete"]);
});

test("assistant tools hide workspaceSlug after workspace context is resolved and inject it on execution", async () => {
  let executed = null;
  const actions = createActions([action({
    input: schema({
      workspaceSlug: { type: "string", required: true },
      title: { type: "string", required: true }
    }),
    execute: async (input, context) => {
      executed = { input, context };
      return { ok: true };
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = {
    actor: { id: "7" },
    surface: "admin",
    workspace: { slug: "library" }
  };
  const toolSet = catalog.resolveToolSet(context);

  assert.equal(Object.hasOwn(toolSet.tools[0].parameters.properties, "workspaceSlug"), false);
  const response = await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    argumentsText: JSON.stringify({ title: "Kindred" }),
    context,
    toolSet
  });

  assert.deepEqual(response, { ok: true, result: { ok: true } });
  assert.deepEqual(executed.input, { workspaceSlug: "library", title: "Kindred" });
  assert.equal(executed.context.channel, "automation");
});

test("assistant tools reject unknown tools and return safe action failures", async () => {
  const actions = createActions([action({
    execute: async () => {
      const error = new Error("Database exploded with secret detail.");
      error.statusCode = 500;
      error.code = "DATABASE_FAILED";
      throw error;
    }
  })]);
  const catalog = createServiceToolCatalog(actions);
  const context = { actor: { id: "7" }, surface: "admin" };
  const toolSet = catalog.resolveToolSet(context);

  assert.deepEqual(await catalog.executeToolCall({ toolName: "missing", context, toolSet }), {
    ok: false,
    error: { code: "assistant_tool_unknown", message: "Unknown tool." }
  });
  assert.deepEqual(await catalog.executeToolCall({
    toolName: toolSet.tools[0].name,
    context,
    toolSet
  }), {
    ok: false,
    error: { code: "DATABASE_FAILED", message: "Tool call failed.", status: 500 }
  });
});
