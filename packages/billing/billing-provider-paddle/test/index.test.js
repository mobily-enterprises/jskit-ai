import assert from "node:assert/strict";
import test from "node:test";
import * as paddleProvider from "../src/index.js";

test("billing paddle provider exports sdk/adapter/translation contracts", () => {
  assert.equal(typeof paddleProvider.createPaddleSdkService, "function");
  assert.equal(typeof paddleProvider.createPaddleBillingProviderAdapterService, "function");
  assert.equal(typeof paddleProvider.createPaddleWebhookTranslationService, "function");
  assert.equal(typeof paddleProvider.mapPaddleProviderError, "function");
});
