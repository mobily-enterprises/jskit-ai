import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import { createCursorListValidator } from "./createCursorListValidator.js";

test("createCursorListValidator builds a list validator from a schema definition", () => {
  const itemValidator = {
    schema: createSchema({
      id: {
        type: "integer",
        required: true,
        min: 1
      },
      label: {
        type: "string",
        required: true,
        minLength: 1
      }
    }),
    mode: "replace"
  };

  const listValidator = createCursorListValidator(itemValidator);
  const transportSchema = listValidator.schema.toJsonSchema({ mode: listValidator.mode });

  assert.equal(listValidator.mode, "replace");
  assert.equal(transportSchema.properties.items.type, "array");
  assert.equal(transportSchema.properties.items.items["x-json-rest-schema"]?.castType, "object");
  assert.equal(Array.isArray(transportSchema.properties.items.items.allOf), true);
  assert.match(transportSchema.properties.items.items.allOf[0]?.$ref || "", /^#\/definitions\//);
  assert.equal(transportSchema.definitions.SchemaNode_1_replace.properties.label.type, "string");
  assert.equal(transportSchema.definitions.SchemaNode_1_replace.properties.label.minLength, 1);
});
