import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeRequiredFieldList,
  deriveRequiredFieldsFromSchema,
  deriveResourceRequiredMetadata
} from "./resourceRequiredMetadata.js";

test("normalizeRequiredFieldList trims, dedupes, and drops empty entries", () => {
  assert.deepEqual(
    normalizeRequiredFieldList([" name ", "color", "name", "", null]),
    ["name", "color"]
  );
  assert.deepEqual(normalizeRequiredFieldList(undefined), []);
});

test("deriveRequiredFieldsFromSchema reads schema.required", () => {
  const schema = {
    type: "object",
    properties: {
      name: { type: "string" },
      color: { type: "string" },
      optionalField: { type: "string" }
    },
    required: ["name", "color"]
  };

  assert.deepEqual(deriveRequiredFieldsFromSchema(schema), ["name", "color"]);
  assert.deepEqual(deriveRequiredFieldsFromSchema({
    ...schema,
    required: []
  }), []);
});

test("deriveResourceRequiredMetadata reads create/replace/patch operation body schemas", () => {
  const fullSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      color: { type: "string" },
      invitesEnabled: { type: "boolean" }
    },
    required: ["name", "color", "invitesEnabled"]
  };
  const patchSchema = {
    ...fullSchema,
    required: []
  };
  const resource = {
    operations: {
      create: { body: { schema: fullSchema } },
      replace: { body: { schema: fullSchema } },
      patch: { body: { schema: patchSchema } }
    }
  };

  assert.deepEqual(deriveResourceRequiredMetadata(resource), {
    create: ["name", "color", "invitesEnabled"],
    replace: ["name", "color", "invitesEnabled"],
    patch: []
  });
});
