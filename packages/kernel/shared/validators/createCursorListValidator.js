import { Type } from "typebox";
import { normalizeObjectInput } from "./inputNormalization.js";
import { normalizeText } from "../support/normalize.js";

function createCursorListValidator(itemValidator) {
  if (!itemValidator || typeof itemValidator !== "object" || Array.isArray(itemValidator)) {
    throw new TypeError("createCursorListValidator requires an item validator object.");
  }

  if (!Object.hasOwn(itemValidator, "schema")) {
    throw new TypeError("createCursorListValidator requires itemValidator.schema.");
  }

  const normalizeItem =
    typeof itemValidator.normalize === "function"
      ? itemValidator.normalize
      : function identity(value) {
          return value;
        };

  return Object.freeze({
    schema: Type.Object(
      {
        items: Type.Array(itemValidator.schema),
        nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
      },
      { additionalProperties: false }
    ),
    normalize(payload = {}) {
      const source = normalizeObjectInput(payload);

      return {
        items: Array.isArray(source.items) ? source.items.map((entry) => normalizeItem(entry)) : [],
        nextCursor: normalizeText(source.nextCursor) || null
      };
    }
  });
}

export { createCursorListValidator };
