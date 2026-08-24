import test from "node:test";
import assert from "node:assert/strict";
import { createSchema } from "json-rest-schema";
import {
  normalizeSingleSchemaDefinition,
  resolveSchemaTransportSchemaDefinition
} from "./schemaDefinitions.js";
import { validateSchemaPayload } from "./schemaPayloadValidation.js";

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

test("temporal schemas preserve strict JSON strings", () => {
  const definition = {
    schema: createSchema({
      serviceDate: { type: "date", required: true },
      openingTime: { type: "time", required: true },
      scheduledAt: { type: "dateTime", required: true }
    }),
    mode: "replace"
  };
  const payload = {
    serviceDate: "2026-08-13",
    openingTime: "07:08:09.123",
    scheduledAt: "2026-08-13T07:08:09.123+08:00"
  };

  assert.deepEqual(validateSchemaPayload(definition, payload), payload);
  assert.throws(
    () => validateSchemaPayload(definition, {
      serviceDate: new Date("2026-08-13T00:00:00.000Z"),
      openingTime: new Date("2026-08-13T07:08:09.123Z"),
      scheduledAt: new Date("2026-08-13T07:08:09.123Z")
    }),
    /Schema validation failed\./
  );
});

test("removed timestamp schemas fail instead of silently changing meaning", () => {
  const definition = {
    schema: createSchema({ occurredAt: { type: "timestamp" } }),
    mode: "replace"
  };

  assert.throws(
    () => validateSchemaPayload(definition, { occurredAt: 1 }),
    /No casting function for type: timestamp/
  );
});

test("unknown nested fields use the owning object additional-properties message", () => {
  const definition = {
    schema: createSchema({
      fields: {
        type: "object",
        schema: createSchema({
          bookings: {
            type: "array",
            items: { type: "string" }
          },
          pets: {
            type: "array",
            items: { type: "string" }
          }
        }),
        messages: {
          additionalProperties: "fields keys must be JSON:API resource types: bookings, pets."
        }
      }
    }),
    mode: "patch"
  };

  assert.throws(
    () => validateSchemaPayload(definition, {
      fields: {
        pet: ["name"]
      }
    }),
    (error) => {
      assert.deepEqual(error.fieldErrors, {
        "fields.pet": "fields keys must be JSON:API resource types: bookings, pets."
      });
      return true;
    }
  );
});
