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
    ),
    normalize(payload = {}) {
      return {
        id: Number(payload.id),
        label: String(payload.label || "").trim()
      };
    }
  };

  const listValidator = createCursorListValidator(itemValidator);
  const normalized = listValidator.normalize({
    items: [{ id: "7", label: " member " }],
    nextCursor: " 8 "
  });

  assert.deepEqual(normalized, {
    items: [{ id: 7, label: "member" }],
    nextCursor: "8"
  });
  assert.equal(listValidator.schema.properties.items.type, "array");
});
