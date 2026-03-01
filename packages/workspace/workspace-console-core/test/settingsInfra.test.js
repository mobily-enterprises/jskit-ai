import assert from "node:assert/strict";
import test from "node:test";
import {
  addFieldError,
  createFieldErrorBag,
  hasFieldErrors,
  toValidationError
} from "../src/lib/settingsInfra.js";

test("settings infra builds and validates field error bags", () => {
  const bag = createFieldErrorBag();
  assert.deepEqual(bag, {});

  addFieldError(bag, "theme", "Theme is invalid.");
  addFieldError(bag, "locale", "Locale is invalid.");

  assert.equal(hasFieldErrors(bag), true);
  assert.deepEqual(bag, {
    theme: "Theme is invalid.",
    locale: "Locale is invalid."
  });
});

test("settings infra maps field errors to application validation error", () => {
  const error = toValidationError(
    (status, message, options = {}) => {
      const nextError = new Error(message);
      nextError.status = status;
      nextError.details = options.details;
      return nextError;
    },
    {
      currencyCode: "Currency code is invalid."
    }
  );

  assert.equal(error.status, 400);
  assert.equal(error.message, "Validation failed.");
  assert.deepEqual(error.details, {
    fieldErrors: {
      currencyCode: "Currency code is invalid."
    }
  });
});
