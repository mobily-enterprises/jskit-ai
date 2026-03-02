import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { __testables as billingControllerTestables } from "@jskit-ai/billing-fastify-routes/controller";
import { BILLING_FAILURE_CODES, statusFromFailureCode } from "@jskit-ai/billing-service-core/constants";

test("billing controller requireIdempotencyKey accepts trimmed header values", () => {
  const request = {
    headers: {
      "idempotency-key": "  idem_123  "
    }
  };

  const result = billingControllerTestables.requireIdempotencyKey(request);
  assert.equal(result, "idem_123");
});

test("billing controller requireIdempotencyKey throws expected AppError when header is missing", () => {
  const request = {
    headers: {}
  };

  assert.throws(
    () => billingControllerTestables.requireIdempotencyKey(request),
    (error) =>
      error instanceof AppError &&
      Number(error.statusCode) === 400 &&
      String(error.code || "") === "IDEMPOTENCY_KEY_REQUIRED"
  );
});

test("billing failure code to HTTP status mapping remains stable", () => {
  assert.equal(statusFromFailureCode(BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR), 502);
  assert.equal(statusFromFailureCode(BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND), 404);
  assert.equal(statusFromFailureCode(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS), 409);
  assert.equal(statusFromFailureCode(BILLING_FAILURE_CODES.IDEMPOTENCY_CONFLICT), 409);
  assert.equal(statusFromFailureCode(""), 409);
});
