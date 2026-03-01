import assert from "node:assert/strict";
import test from "node:test";
import * as billingProviderCore from "../../src/lib/index.js";

test("billing.provider-contract contract exports required symbols", () => {
  assert.equal(typeof billingProviderCore.assertProviderAdapter, "function");
  assert.equal(typeof billingProviderCore.createProviderRegistry, "function");
  assert.equal(typeof billingProviderCore.assertWebhookTranslator, "function");
});

