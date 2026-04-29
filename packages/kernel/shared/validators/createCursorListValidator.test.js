import test from "node:test";
import assert from "node:assert/strict";
import { createCursorListValidator } from "./createCursorListValidator.js";

test("createCursorListValidator builds a list validator from an item validator", () => {
  const itemValidator = {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: {
          type: "integer",
          minimum: 1
        },
        label: {
          type: "string",
          minLength: 1
        }
      },
      required: ["id", "label"]
    }
  };

  const listValidator = createCursorListValidator(itemValidator);
  assert.equal(listValidator.normalize, undefined);
  assert.equal(listValidator.schema.properties.items.type, "array");
  assert.deepEqual(listValidator.schema.properties.items.items.properties.label, {
    type: "string",
    minLength: 1
  });
});
