import assert from "node:assert/strict";
import test from "node:test";
import { createToolArgsSchema } from "./createToolArgsSchema.js";

test("createToolArgsSchema builds deterministic args/options object schema", () => {
  const schema = createToolArgsSchema(
    [
      {
        type: "integer",
        minimum: 1
      },
      {
        type: "object",
        additionalProperties: false
      }
    ],
    {
      minItems: 2,
      maxItems: 2
    }
  );

  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.args.type, "array");
  assert.equal(schema.properties.args.minItems, 2);
  assert.equal(schema.properties.args.maxItems, 2);
  assert.equal(Array.isArray(schema.properties.args.prefixItems), true);
  assert.equal(schema.properties.args.prefixItems.length, 2);
  assert.equal(schema.properties.options.type, "object");
  assert.equal(schema.properties.options.additionalProperties, true);
});

