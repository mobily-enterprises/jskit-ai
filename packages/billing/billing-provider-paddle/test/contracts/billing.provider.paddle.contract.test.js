import assert from "node:assert/strict";
import test from "node:test";
import * as billingProviderPaddle from "../../src/shared/index.js";

test("billing.provider.paddle contract exports required symbols", () => {
  assert.equal(typeof billingProviderPaddle.createPaddleBillingProviderAdapterService, "function");
  assert.equal(typeof billingProviderPaddle.createPaddleWebhookTranslationService, "function");
});

