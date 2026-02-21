import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { mapPaddleProviderError } from "../server/modules/billing/providers/paddle/errorMapping.js";
import { mapStripeProviderError } from "../server/modules/billing/providers/stripe/errorMapping.js";
import {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  createBillingProviderError,
  isBillingProviderError
} from "../server/modules/billing/providers/shared/providerError.contract.js";

test("stripe provider error mapping normalizes sdk network failures", () => {
  const source = new Error("Connection timed out while calling Stripe");
  source.type = "StripeAPIConnectionError";
  source.requestId = "req_123";

  const mapped = mapStripeProviderError(source, {
    operation: "checkout_create"
  });

  assert.equal(isBillingProviderError(mapped), true);
  assert.equal(mapped.provider, "stripe");
  assert.equal(mapped.operation, "checkout_create");
  assert.equal(mapped.category, BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK);
  assert.equal(mapped.retryable, true);
  assert.equal(mapped.providerRequestId, "req_123");
});

test("stripe provider error mapping keeps app and canonical provider errors unchanged", () => {
  const appError = new AppError(400, "Validation failed.");
  const canonical = createBillingProviderError({
    provider: "stripe",
    operation: "checkout_create",
    category: BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST,
    message: "Invalid request."
  });

  assert.equal(mapStripeProviderError(appError), appError);
  assert.equal(mapStripeProviderError(canonical), canonical);
});

test("paddle provider error mapping normalizes response and transport failures", () => {
  const validationError = new Error("Payload validation failed.");
  validationError.code = "validation_error";
  validationError.statusCode = 422;

  const mappedValidation = mapPaddleProviderError(validationError, {
    operation: "payment_link_create"
  });
  assert.equal(isBillingProviderError(mappedValidation), true);
  assert.equal(mappedValidation.provider, "paddle");
  assert.equal(mappedValidation.category, BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST);
  assert.equal(mappedValidation.retryable, false);

  const networkError = new Error("Network connection reset by peer");
  networkError.code = "ECONNRESET";
  const mappedNetwork = mapPaddleProviderError(networkError, {
    operation: "subscription_retrieve"
  });
  assert.equal(mappedNetwork.category, BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK);
  assert.equal(mappedNetwork.retryable, true);
});
