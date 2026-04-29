import test from "node:test";
import assert from "node:assert/strict";

import { recordIdParamsValidator } from "./recordIdParamsValidator.js";

test("recordIdParamsValidator normalizes canonical string ids", () => {
  const { validatedObject, errors } = recordIdParamsValidator.schema.patch({ recordId: "42" });
  assert.deepEqual(errors, {});
  assert.deepEqual(validatedObject, {
    recordId: "42"
  });
});

test("recordIdParamsValidator rejects invalid ids", () => {
  const invalidString = recordIdParamsValidator.schema.patch({ recordId: "nope" });
  assert.equal(invalidString.validatedObject.recordId, "nope");
  assert.equal(invalidString.errors.recordId?.code, "PATTERN");

  const numericId = recordIdParamsValidator.schema.patch({ recordId: 42 });
  assert.equal(numericId.validatedObject.recordId, "42");
  assert.deepEqual(numericId.errors, {});
});

test("recordIdParamsValidator keeps absent key absent", () => {
  const { validatedObject, errors } = recordIdParamsValidator.schema.patch({});
  assert.deepEqual(errors, {});
  assert.deepEqual(validatedObject, {});
});
