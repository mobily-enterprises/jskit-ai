import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
import { createCursorListValidator } from "./createCursorListValidator.js";

test("createCursorListValidator builds a list validator from an item validator", () => {
  const itemValidator = {
    schema: Type.Object(
      {
        id: Type.Integer({ minimum: 1 }),
        label: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  };

  const listValidator = createCursorListValidator(itemValidator);
  assert.equal(listValidator.normalize, undefined);
  assert.equal(listValidator.schema.properties.items.type, "array");
  assert.deepEqual(listValidator.schema.properties.items.items.properties.label, {
    type: "string",
    minLength: 1
  });
});
