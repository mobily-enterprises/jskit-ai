import assert from "node:assert/strict";
import test from "node:test";
import { nestValidator } from "./nestValidator.js";

test("nestValidator wraps schema + normalize under one key", async () => {
  const baseValidator = Object.freeze({
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          minLength: 1
        }
      }
    },
    normalize(payload = {}) {
      return {
        ...(Object.hasOwn(payload, "name") ? { name: String(payload.name).trim() } : {})
      };
    }
  });
  const validator = nestValidator("payload", baseValidator);

  const normalized = await validator.normalize({
    payload: {
      name: "  Acme  "
    }
  });

  assert.deepEqual(normalized, {
    payload: {
      name: "Acme"
    }
  });
  assert.equal(validator.schema.type, "object");
  assert.deepEqual(validator.schema.required, ["payload"]);
});

test("nestValidator can define optional nested key", async () => {
  const validator = nestValidator(
    "patch",
    Object.freeze({
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: {
            type: "string",
            minLength: 1
          }
        }
      }
    }),
    { required: false }
  );

  assert.deepEqual(await validator.normalize({}), {});
  assert.equal(Array.isArray(validator.schema.required), false);
  assert.equal(typeof validator.schema.properties.patch, "object");
});

test("nestValidator rejects invalid key and validator", () => {
  assert.throws(() => nestValidator("", { schema: { type: "object", properties: {} } }), /requires a non-empty key/);
  assert.throws(() => nestValidator("payload", null), /requires a validator object with schema/);
});
