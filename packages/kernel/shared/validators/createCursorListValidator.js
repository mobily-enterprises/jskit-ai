import { Type } from "typebox";
import { resolveStructuredSchemaTransportSchema } from "./schemaDefinitions.js";

function createCursorListValidator(itemValidator) {
  if (!itemValidator || typeof itemValidator !== "object" || Array.isArray(itemValidator)) {
    throw new TypeError("createCursorListValidator requires an item validator object.");
  }

  const itemSchema = resolveStructuredSchemaTransportSchema(itemValidator, {
    context: "cursor list item",
    defaultMode: "replace"
  });
  if (!itemSchema || typeof itemSchema !== "object" || Array.isArray(itemSchema)) {
    throw new TypeError("createCursorListValidator requires a resolvable item schema definition.");
  }

  return Object.freeze({
    get schema() {
      return Type.Object(
        {
          items: Type.Array(itemSchema),
          nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()])
        },
        { additionalProperties: false }
      );
    }
  });
}

export { createCursorListValidator };
