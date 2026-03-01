import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_DEFAULT_PROVIDER,
  BILLING_FAILURE_CODES,
  createBillingService,
  createBillingPricingService,
  createBillingWebhookService
} from "../src/lib/index.js";

test("billing service core exports domain services and constants", () => {
  assert.equal(BILLING_DEFAULT_PROVIDER, "stripe");
  assert.equal(BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR, "checkout_provider_error");
  assert.equal(typeof createBillingService, "function");
  assert.equal(typeof createBillingPricingService, "function");
  assert.equal(typeof createBillingWebhookService, "function");
});
