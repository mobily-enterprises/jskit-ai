import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceAwareToolCatalog } from "../src/server/support/createSurfaceAwareToolCatalog.js";

test("surface-aware tool catalog applies per-surface skip and barred configuration", async () => {
  const observed = [];
  const catalog = createSurfaceAwareToolCatalog(
    {},
    {
      appConfig: {
        assistantServer: {
          admin: {
            barredActionIds: ["demo.admin.secret"],
            toolSkipActionPrefixes: ["demo.admin."]
          },
          console: {
            barredActionIds: ["demo.console.secret"]
          }
        }
      },
      createCatalog(_scope, options = {}) {
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
      skipActionPrefixes: ["assistant.", "demo.admin."]
    },
    {
      barredActionIds: ["demo.console.secret"],
      skipActionPrefixes: ["assistant."]
    }
  ]);
  assert.deepEqual(execution.options, {
    barredActionIds: ["demo.admin.secret"],
    skipActionPrefixes: ["assistant.", "demo.admin."]
  });
});
