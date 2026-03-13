import test from "node:test";
import assert from "node:assert/strict";
import { Type } from "typebox";
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
  const schema = Type.Object({
    name: Type.String(),
    color: Type.String(),
    optionalField: Type.Optional(Type.String())
  });

  assert.deepEqual(deriveRequiredFieldsFromSchema(schema), ["name", "color"]);
  assert.deepEqual(deriveRequiredFieldsFromSchema(Type.Partial(schema)), []);
});

test("deriveResourceRequiredMetadata reads create/replace/patch operation body schemas", () => {
  const fullSchema = Type.Object({
    name: Type.String(),
    color: Type.String(),
    invitesEnabled: Type.Boolean()
  });
  const patchSchema = Type.Partial(fullSchema);
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
