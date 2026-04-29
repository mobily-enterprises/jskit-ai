import { createSchema } from "json-rest-schema";
import { deepFreeze } from "../support/deepFreeze.js";
import { normalizeSingleSchemaDefinition } from "./schemaDefinitions.js";

function createCursorListValidator(itemValidator) {
  const itemDefinition = normalizeSingleSchemaDefinition(itemValidator, {
    context: "cursor list item",
    defaultMode: "replace"
  });

  return deepFreeze({
    schema: createSchema({
      items: {
        type: "array",
        required: true,
        items: itemDefinition.schema
      },
      nextCursor: {
        type: "string",
        required: false,
        nullable: true,
        minLength: 1
      }
    }),
    mode: "replace"
  });
}

export { createCursorListValidator };
