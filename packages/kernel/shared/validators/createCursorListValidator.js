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
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: itemSchema
        },
        nextCursor: {
          anyOf: [
            {
              type: "string",
              minLength: 1
            },
            {
              type: "null"
            }
          ]
        }
      }
    }
  });
}

export { createCursorListValidator };
