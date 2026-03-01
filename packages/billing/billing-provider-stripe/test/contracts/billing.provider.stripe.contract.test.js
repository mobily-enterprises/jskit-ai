import assert from "node:assert/strict";
import test from "node:test";
import * as billingProviderStripe from "../../src/lib/index.js";

test("billing.provider.stripe contract exports required symbols", () => {
  assert.equal(typeof billingProviderStripe.createStripeBillingProviderAdapterService, "function");
  assert.equal(typeof billingProviderStripe.createStripeWebhookTranslationService, "function");
});

