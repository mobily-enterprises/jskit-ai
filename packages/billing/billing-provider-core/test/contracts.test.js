import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  validateProviderAdapter,
  assertProviderAdapter,
  normalizeProviderCode,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  validateWebhookTranslator,
  assertWebhookTranslator,
  shouldProcessCanonicalWebhookEvent
} from "../src/index.js";

function createStubAdapter(provider = "stripe") {
  const adapter = {
    provider
  };

  for (const methodName of REQUIRED_PROVIDER_ADAPTER_METHODS) {
    adapter[methodName] = async () => null;
  }

  return adapter;
}

test("provider adapter validation reports missing fields and methods", () => {
  const validation = validateProviderAdapter({});

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.missingFields, ["provider"]);
  assert.equal(validation.missingMethods.length, REQUIRED_PROVIDER_ADAPTER_METHODS.length);
  assert.ok(validation.missingMethods.includes("createCheckoutSession"));
  assert.ok(validation.missingMethods.includes("verifyWebhookEvent"));

  assert.throws(() => assertProviderAdapter({}, { name: "adapterUnderTest" }), /adapterUnderTest\.provider/);
});

test("provider adapter assertion accepts valid adapter shape", () => {
  const adapter = createStubAdapter("stripe");
  assert.equal(assertProviderAdapter(adapter), adapter);
});

test("normalizeProviderCode trims and lowercases provider identifiers", () => {
  assert.equal(normalizeProviderCode("  StrIPE "), "stripe");
  assert.equal(normalizeProviderCode(""), "");
  assert.equal(normalizeProviderCode(null), "");
});

test("webhook translator validation reports missing fields and methods", () => {
  const validation = validateWebhookTranslator({});

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.missingFields, ["provider"]);
  assert.equal(validation.missingMethods.length, REQUIRED_WEBHOOK_TRANSLATOR_METHODS.length);
  assert.ok(validation.missingMethods.includes("toCanonicalEvent"));
  assert.ok(validation.missingMethods.includes("supportsCanonicalEventType"));

  assert.throws(() => assertWebhookTranslator({}, { name: "translatorUnderTest" }), /translatorUnderTest\.provider/);
});

test("canonical webhook event filter only accepts supported canonical event types", () => {
  assert.equal(shouldProcessCanonicalWebhookEvent("invoice.paid"), true);
  assert.equal(shouldProcessCanonicalWebhookEvent("invoice.payment_failed"), true);
  assert.equal(shouldProcessCanonicalWebhookEvent("notification.created"), false);
  assert.equal(shouldProcessCanonicalWebhookEvent(""), false);
});
