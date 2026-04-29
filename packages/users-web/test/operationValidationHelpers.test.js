import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";
import { validateOperationInput } from "../src/client/composables/runtime/operationValidationHelpers.js";

test("validateOperationInput validates a schema definition and returns normalized input", () => {
  const rawPayload = {
    name: "  Acme  "
  };

  const result = validateOperationInput({
    input: {
      schema: createSchema({
        name: { type: "string", required: true, minLength: 1 }
      }),
      mode: "patch"
    },
    rawPayload
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.parsedInput, {
    name: "Acme"
  });
});

test("validateOperationInput returns validation failures for invalid schema input", () => {
  const result = validateOperationInput({
    input: {
      schema: createSchema({
        name: {
          type: "string",
          required: true,
          minLength: 1,
          messages: {
            minLength: "Name is required."
          }
        }
      }),
      mode: "patch"
    },
    rawPayload: {
      name: ""
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure.code, "validation_failed");
  assert.equal(result.failure.fieldErrors.name, "Name is required.");
});

test("validateOperationInput rethrows malformed input contracts", () => {
  assert.throws(
    () =>
      validateOperationInput({
        input: {
          schema: null,
          mode: "patch"
        },
        rawPayload: {}
      }),
    /must be a json-rest-schema schema instance/
  );
});
