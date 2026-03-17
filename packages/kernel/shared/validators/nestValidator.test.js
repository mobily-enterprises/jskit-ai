import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import { Type } from "typebox";
import { nestValidator } from "./nestValidator.js";

test("nestValidator wraps schema + normalize under one key", async () => {
  const baseValidator = Object.freeze({
    schema: Type.Object(
      {
        name: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    ),
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
  assert.equal(Check(validator.schema, normalized), true);
  assert.equal(Check(validator.schema, {}), false);
});

test("nestValidator can define optional nested key", async () => {
  const validator = nestValidator(
    "patch",
    Object.freeze({
      schema: Type.Object(
        {
          title: Type.Optional(Type.String({ minLength: 1 }))
        },
        { additionalProperties: false }
      )
    }),
    { required: false }
  );

  assert.deepEqual(await validator.normalize({}), {});
  assert.equal(Check(validator.schema, {}), true);
  assert.equal(Check(validator.schema, { patch: { title: "X" } }), true);
});

test("nestValidator rejects invalid key and validator", () => {
  assert.throws(() => nestValidator("", { schema: Type.Object({}) }), /requires a non-empty key/);
  assert.throws(() => nestValidator("payload", null), /requires a validator object with schema/);
});
