import assert from "node:assert/strict";
import test from "node:test";
import { AppError, isAppError } from "../src/server/errors.js";

test("AppError preserves configured fields", () => {
  const error = new AppError(422, "Validation failed.", {
    code: "VALIDATION_ERROR",
    details: { field: "email" },
    headers: { "x-test": "1" }
  });

  assert.equal(error.name, "AppError");
  assert.equal(error.status, 422);
  assert.equal(error.statusCode, 422);
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.deepEqual(error.details, { field: "email" });
  assert.deepEqual(error.headers, { "x-test": "1" });
  assert.equal(isAppError(error), true);
  assert.equal(isAppError(new Error("x")), false);
});

test("AppError invalid status values fall back to 500", () => {
  const invalidString = new AppError("not-a-number", "Oops");
  const invalidZero = new AppError(0, "Oops");

  assert.equal(invalidString.status, 500);
  assert.equal(invalidString.statusCode, 500);
  assert.equal(invalidZero.status, 500);
  assert.equal(invalidZero.statusCode, 500);
  assert.equal(invalidZero.code, "APP_ERROR");
  assert.deepEqual(invalidZero.headers, {});
});
