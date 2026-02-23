import assert from "node:assert/strict";
import test from "node:test";

import { BILLING_PROVIDER_STRIPE } from "../server/modules/billing/constants.js";
import {
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  normalizeBillingProviderCode,
  validateBillingProviderAdapter,
  assertBillingProviderAdapter
} from "../server/modules/billing/providers/shared/providerAdapter.contract.js";
import { createService as createBillingProviderRegistryService } from "../server/modules/billing/providers/shared/providerRegistry.service.js";
import { createService as createStripeBillingProviderAdapterService } from "../server/modules/billing/providers/stripe/adapter.service.js";
import { createService as createPaddleBillingProviderAdapterService } from "../server/modules/billing/providers/paddle/adapter.service.js";

function createStubProviderAdapter(provider = "stub") {
  const adapter = {
    provider
  };

  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    adapter[methodName] = async () => null;
  }

  return adapter;
}

test("billing provider adapter contract validation reports missing fields and methods", () => {
  const validation = validateBillingProviderAdapter({});
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.missingFields, ["provider"]);
  assert.ok(validation.missingMethods.includes("createCheckoutSession"));
  assert.ok(validation.missingMethods.includes("verifyWebhookEvent"));
  assert.equal(validation.missingMethods.length, REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS.length);

  assert.throws(
    () => assertBillingProviderAdapter({}, { name: "adapterUnderTest" }),
    /adapterUnderTest\.provider/
  );
});

test("billing provider registry resolves default and explicitly requested providers", () => {
  const stripeAdapter = createStubProviderAdapter("stripe");
  const registry = createBillingProviderRegistryService({
    adapters: [stripeAdapter],
    defaultProvider: "stripe"
  });

  assert.equal(registry.getDefaultProvider(), "stripe");
  assert.equal(registry.resolveProvider(), stripeAdapter);
  assert.equal(registry.resolveProvider("STRIPE"), stripeAdapter);
  assert.equal(registry.hasProvider("stripe"), true);

  const manualAdapter = createStubProviderAdapter("manual");
  registry.registerAdapter(manualAdapter);
  assert.equal(registry.resolveProvider("manual"), manualAdapter);
  assert.deepEqual(registry.listProviders(), ["stripe", "manual"]);

  assert.throws(() => registry.resolveProvider("unknown"), /Unsupported billing provider: unknown/);
  assert.throws(
    () => registry.registerAdapter(createStubProviderAdapter("stripe")),
    /Billing provider already registered: stripe/
  );
});

test("stripe billing provider adapter delegates full contract to stripe sdk service", async () => {
  const calls = [];
  const stripeSdkService = {};

  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    stripeSdkService[methodName] = async (payload) => {
      calls.push({
        methodName,
        payload
      });
      return {
        methodName,
        payload
      };
    };
  }

  const adapter = createStripeBillingProviderAdapterService({
    stripeSdkService
  });

  assert.equal(adapter.provider, BILLING_PROVIDER_STRIPE);

  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    const payload = {
      key: methodName
    };
    const response = await adapter[methodName](payload);
    assert.deepEqual(response, {
      methodName,
      payload
    });
  }

  assert.equal(calls.length, REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS.length);

  const missingVerifyWebhookEventService = {
    ...stripeSdkService
  };
  delete missingVerifyWebhookEventService.verifyWebhookEvent;

  assert.throws(
    () => createStripeBillingProviderAdapterService({ stripeSdkService: missingVerifyWebhookEventService }),
    /stripeSdkService\.verifyWebhookEvent is required/
  );
});

test("normalizeBillingProviderCode trims and lowercases provider identifiers", () => {
  assert.equal(normalizeBillingProviderCode("  StrIPE "), "stripe");
  assert.equal(normalizeBillingProviderCode(""), "");
  assert.equal(normalizeBillingProviderCode(null), "");
});

test("paddle billing provider adapter delegates full contract to paddle sdk service", async () => {
  const calls = [];
  const paddleSdkService = {};
  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    paddleSdkService[methodName] = async (payload) => {
      calls.push({
        methodName,
        payload
      });
      return {
        methodName,
        payload
      };
    };
  }

  const adapter = createPaddleBillingProviderAdapterService({
    paddleSdkService
  });
  assert.equal(adapter.provider, "paddle");

  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    const payload = {
      key: methodName
    };
    const result = await adapter[methodName](payload);
    assert.deepEqual(result, {
      methodName,
      payload
    });
  }

  assert.equal(calls.length, REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS.length);
});
