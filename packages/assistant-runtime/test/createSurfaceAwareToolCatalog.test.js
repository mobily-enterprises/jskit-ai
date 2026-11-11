import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createSurfaceAwareToolCatalog } from "../src/server/support/createSurfaceAwareToolCatalog.js";

test("surface-aware tool catalog applies per-surface skip and barred configuration", async () => {
  const observed = [];
  const actions = { listDefinitions: () => [], async execute() {} };
  const catalog = createSurfaceAwareToolCatalog(
    actions,
    {
      appConfig: {
        assistantServer: {
          admin: {
            barredActionIds: ["demo.admin.secret"],
            toolSkipActionPrefixes: ["demo.admin."],
            maxToolArgumentBytes: 65536
          },
          console: {
            barredActionIds: ["demo.console.secret"]
          }
        }
      },
      createCatalog(receivedActions, options = {}) {
        assert.equal(receivedActions, actions);
        observed.push(options);
        return {
          resolveToolSet(context = {}) {
            return {
              tools: [
                {
                  name: `tool:${String(context.surface || "default")}`
                }
              ],
              byName: new Map()
            };
          },
          toOpenAiToolSchema(tool) {
            return {
              tool
            };
          },
          async executeToolCall(payload = {}) {
            return {
              ok: true,
              payload,
              options
            };
          }
        };
      }
    }
  );

  assert.deepEqual(catalog.resolveToolSet({ surface: "admin" }).tools, [{ name: "tool:admin" }]);
  assert.deepEqual(catalog.resolveToolSet({ surface: "console" }).tools, [{ name: "tool:console" }]);
  assert.throws(() => catalog.resolveToolSet({}), /requires context\.surface/);

  const execution = await catalog.executeToolCall({
    toolName: "demo",
    context: {
      surface: "admin"
    }
  });
  assert.throws(() => catalog.executeToolCall({ toolName: "demo", context: {} }), /requires context\.surface/);

  assert.deepEqual(observed, [
    {
      barredActionIds: ["demo.admin.secret"],
      skipActionPrefixes: ["assistant.", "demo.admin."],
      maxToolArgumentBytes: 65536
    },
    {
      barredActionIds: ["demo.console.secret"],
      skipActionPrefixes: ["assistant."]
    }
  ]);
  assert.deepEqual(execution.options, {
    barredActionIds: ["demo.admin.secret"],
    skipActionPrefixes: ["assistant.", "demo.admin."],
    maxToolArgumentBytes: 65536
  });
});

test("each surface's tool sets carry and enforce its maxToolArgumentBytes", async () => {
  const lengths = [];
  const actions = createActionCatalogue();
  actions.register({ contributorId: "test.documents", domain: "test", actions: [{
    id: "documents.propose", version: 1, kind: "command", channels: ["automation"], surfaces: ["writer", "home"],
    permission: { require: "authenticated" },
    input: { schema: createSchema({ text: { type: "string", required: true } }), mode: "replace" },
    output: { schema: createSchema({ length: { type: "number", required: true } }), mode: "replace" },
    execute: async ({ text }) => { lengths.push(text.length); return { length: text.length }; }
  }] });
  const catalog = createSurfaceAwareToolCatalog(actions, { appConfig: { assistantServer: { writer: { maxToolArgumentBytes: 64 * 1024 } } } });
  const argumentsText = JSON.stringify({ text: "x".repeat(40 * 1024) });
  const call = surface => {
    const context = { actor: { id: "owner" }, surface };
    const toolSet = catalog.resolveToolSet(context);
    return { limit: toolSet.limits.maxToolArgumentBytes,
      result: catalog.executeToolCall({ toolName: toolSet.tools[0].name, argumentsText, context, toolSet }) };
  };

  const writer = call("writer");
  assert.equal(writer.limit, 64 * 1024);
  assert.deepEqual(await writer.result, { ok: true, result: { length: 40 * 1024 } });
  const home = call("home");
  assert.equal(home.limit, 32 * 1024, "A surface without the key keeps the default");
  assert.equal((await home.result).error.code, "assistant_tool_arguments_too_large");
  assert.deepEqual(lengths, [40 * 1024]);
});

test("an application reaches the surface-aware tool catalog through the package's server entry", async () => {
  const server = await import("@jskit-ai/assistant-runtime/server");
  assert.equal(server.createSurfaceAwareToolCatalog, createSurfaceAwareToolCatalog);
});
