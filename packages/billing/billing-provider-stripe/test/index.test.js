import assert from "node:assert/strict";
import test from "node:test";
import * as stripeProvider from "../src/shared/index.js";

test("billing stripe provider exports sdk/adapter/translation contracts", () => {
  assert.equal(typeof stripeProvider.createStripeSdkService, "function");
  assert.equal(typeof stripeProvider.createStripeBillingProviderAdapterService, "function");
  assert.equal(typeof stripeProvider.createStripeWebhookTranslationService, "function");
  assert.equal(typeof stripeProvider.mapStripeProviderError, "function");
});
