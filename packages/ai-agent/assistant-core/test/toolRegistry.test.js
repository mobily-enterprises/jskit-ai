import test from "node:test";
import assert from "node:assert/strict";
import { buildAiToolRegistry, executeToolCall, listToolSchemas } from "../src/shared/toolRegistry.js";

test("tool registry mechanics build schema descriptors and execute allowed tools", async () => {
  const tool = {
    name: "echo",
    description: "Echo payload",
    inputJsonSchema: { type: "object" },
    requiredPermissions: ["assistant.tools.echo"],
    async execute({ args }) {
      return { echoed: args };
    }
  };

  const registry = buildAiToolRegistry({
    tools: [tool]
  });
  const schemas = listToolSchemas(registry);
  assert.equal(schemas.length, 1);
  assert.equal(schemas[0].function.name, "echo");

  const result = await executeToolCall(registry, {
    name: "echo",
    args: { value: 42 },
    context: {
      permissions: ["assistant.tools.echo"]
    }
  });
  assert.deepEqual(result, { echoed: { value: 42 } });

  await assert.rejects(
    () =>
      executeToolCall(registry, {
        name: "echo",
        args: {},
        context: {
          permissions: []
        }
      }),
    /Forbidden/
  );
});
