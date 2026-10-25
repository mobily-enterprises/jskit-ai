import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeFieldErrors,
  resolveFieldErrors,
  createValidationFailure,
  createHttpError,
  createNetworkError,
  isGenericHttpErrorMessage
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

test("createHttpError preserves standard error envelopes that also contain an errors list", () => {
  const error = createHttpError(
    {
      status: 409
    },
    {
      code: "resource_conflict",
      details: {
        code: "resource_conflict"
      },
      error: "Finish the pending operation first.",
      errors: [
        {
          code: "resource_conflict",
          message: "Finish the pending operation first."
        }
      ],
      ok: false
    }
  );

  assert.equal(error.status, 409);
  assert.equal(error.code, "resource_conflict");
  assert.equal(
    error.message,
    "Finish the pending operation first."
  );
  assert.deepEqual(error.details, {
    code: "resource_conflict"
  });
});

test("createHttpError reads errors-list messages when a standard envelope has no top-level message", () => {
  const error = createHttpError(
    {
      status: 400
    },
    {
      errors: [
        {
          code: "invalid_request",
          message: "The request is invalid."
        }
      ]
    }
  );

  assert.equal(error.message, "The request is invalid.");
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

test("isGenericHttpErrorMessage recognises only the transport's own wording", () => {
  assert.equal(isGenericHttpErrorMessage(createHttpError({ status: 500 }, {})), true);
  assert.equal(isGenericHttpErrorMessage(createNetworkError(new Error("offline"))), true);
  assert.equal(isGenericHttpErrorMessage(createHttpError({ status: 500 }, { error: "Server exploded" })), false);
  assert.equal(isGenericHttpErrorMessage({ statusCode: 404, message: "Request failed with status 404." }), true);
  assert.equal(isGenericHttpErrorMessage({ message: "Request failed with status 500." }), false);
  assert.equal(isGenericHttpErrorMessage(null), false);
});
