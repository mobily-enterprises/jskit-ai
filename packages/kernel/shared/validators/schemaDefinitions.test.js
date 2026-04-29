import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  normalizeSingleSchemaDefinition,
  resolveSchemaTransportSchemaDefinition
} from "./schemaDefinitions.js";

test("normalizeSingleSchemaDefinition validates mode eagerly", () => {
  const definition = {
    schema: createSchema({
      name: { type: "string", required: true, minLength: 1 }
    }),
    mode: "wrong"
  };

  assert.throws(
    () => normalizeSingleSchemaDefinition(definition, {
      context: "test.definition"
    }),
    /test\.definition\.mode must be one of: create, replace, patch\./
  );
});

test("normalizeSingleSchemaDefinition preserves valid normalized mode", () => {
  const definition = normalizeSingleSchemaDefinition({
    schema: createSchema({
      name: { type: "string", required: true, minLength: 1 }
    }),
    mode: " Replace "
  }, {
    context: "test.definition"
  });

  assert.equal(definition.mode, "replace");
});

test("resolveSchemaTransportSchemaDefinition still resolves valid definitions", () => {
  const transportSchema = resolveSchemaTransportSchemaDefinition({
    schema: createSchema({
      name: { type: "string", required: true, minLength: 1 }
    }),
    mode: "patch"
  }, {
    context: "test.definition"
  });

  assert.equal(transportSchema.type, "object");
  assert.equal(transportSchema.additionalProperties, false);
  assert.equal(transportSchema.properties.name.type, "string");
});
