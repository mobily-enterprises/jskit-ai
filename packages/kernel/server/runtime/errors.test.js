import assert from "node:assert/strict";
import test from "node:test";

import {
  AppError,
  DomainError,
  DomainValidationError,
  ConflictError,
  NotFoundError,
  isAppError,
  isDomainError,
  createValidationError
} from "./errors.js";

test("DomainValidationError defaults to 422 and domain_validation_failed", () => {
  const error = new DomainValidationError(["email is required"]);

  assert.equal(error.status, 422);
  assert.equal(error.statusCode, 422);
  assert.equal(error.code, "domain_validation_failed");
  assert.equal(error.message, "Domain validation failed.");
  assert.deepEqual(error.details, ["email is required"]);
  assert.equal(error.name, "DomainValidationError");
});

test("ConflictError defaults to 409 and conflict", () => {
  const error = new ConflictError("Duplicate contact.", {
    details: { email: "alice@example.com" }
  });

  assert.equal(error.status, 409);
  assert.equal(error.code, "conflict");
  assert.equal(error.message, "Duplicate contact.");
  assert.deepEqual(error.details, { email: "alice@example.com" });
  assert.equal(error.name, "ConflictError");
});

test("NotFoundError defaults to 404 and not_found", () => {
  const error = new NotFoundError("Contact not found.", {
    details: { id: "contact-1" }
  });

  assert.equal(error.status, 404);
  assert.equal(error.code, "not_found");
  assert.equal(error.message, "Contact not found.");
  assert.deepEqual(error.details, { id: "contact-1" });
  assert.equal(error.name, "NotFoundError");
});

test("isDomainError identifies DomainError subclasses and isAppError remains true", () => {
  const domainError = new DomainError(422, "Domain failed.", {
    code: "domain_failed"
  });

  assert.equal(isDomainError(domainError), true);
  assert.equal(isAppError(domainError), true);

  const appError = new AppError(500, "App failed.");
  assert.equal(isDomainError(appError), false);
  assert.equal(isAppError(appError), true);
});

test("createValidationError remains compatible", () => {
  const error = createValidationError({ email: "Invalid." });

  assert.equal(error.status, 400);
  assert.equal(error.message, "Validation failed.");
  assert.deepEqual(error.details, {
    fieldErrors: {
      email: "Invalid."
    }
  });
});
