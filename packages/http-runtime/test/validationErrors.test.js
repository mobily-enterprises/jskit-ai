import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFieldErrors,
  resolveFieldErrors,
  createValidationFailure,
  createHttpError
} from "../src/client/index.js";

test("normalizeFieldErrors trims keys and stringifies values", () => {
  const normalized = normalizeFieldErrors({
    " name ": "Required",
    count: 3,
    "": "skip-me",
    "   ": "skip-me-too"
  });

  assert.deepEqual(normalized, {
    name: "Required",
    count: "3"
  });
});

test("resolveFieldErrors reads top-level and nested details field errors", () => {
  assert.deepEqual(
    resolveFieldErrors({
      fieldErrors: {
        email: "Invalid email."
      }
    }),
    {
      email: "Invalid email."
    }
  );

  assert.deepEqual(
    resolveFieldErrors({
      details: {
        fieldErrors: {
          password: "Too short."
        }
      }
    }),
    {
      password: "Too short."
    }
  );
});

test("createValidationFailure returns canonical validation envelope", () => {
  const failure = createValidationFailure({
    error: "Validation failed.",
    code: "validation_failed",
    fieldErrors: {
      name: "Name is required."
    }
  });

  assert.deepEqual(failure, {
    error: "Validation failed.",
    code: "validation_failed",
    fieldErrors: {
      name: "Name is required."
    },
    details: {
      fieldErrors: {
        name: "Name is required."
      }
    }
  });
});

test("createHttpError normalizes code and fieldErrors", () => {
  const error = createHttpError(
    {
      status: 422
    },
    {
      error: "Validation failed.",
      code: "invalid_input",
      details: {
        fieldErrors: {
          " email ": "Invalid email."
        }
      }
    }
  );

  assert.equal(error.status, 422);
  assert.equal(error.code, "invalid_input");
  assert.deepEqual(error.fieldErrors, {
    email: "Invalid email."
  });
  assert.deepEqual(error.details, {
    fieldErrors: {
      " email ": "Invalid email."
    }
  });
});

test("createHttpError decodes json:api error documents into the existing fieldErrors shape", () => {
  const error = createHttpError(
    {
      status: 422
    },
    {
      errors: [
        {
          status: "422",
          code: "invalid_input",
          title: "Validation failed.",
          detail: "Name is required.",
          source: {
            pointer: "/data/attributes/name"
          }
        }
      ]
    }
  );

  assert.equal(error.status, 422);
  assert.equal(error.code, "invalid_input");
  assert.equal(error.message, "Name is required.");
  assert.deepEqual(error.fieldErrors, {
    name: "Name is required."
  });
  assert.deepEqual(error.details, {
    fieldErrors: {
      name: "Name is required."
    }
  });
});
