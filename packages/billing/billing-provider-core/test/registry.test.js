import assert from "node:assert/strict";
import test from "node:test";

import { createProviderRegistry, REQUIRED_PROVIDER_ADAPTER_METHODS, assertProviderAdapter } from "../src/shared/index.js";

function createStubAdapter(provider = "stub") {
  const adapter = {
    provider
  };

  for (const methodName of REQUIRED_PROVIDER_ADAPTER_METHODS) {
    adapter[methodName] = async () => null;
  }

  return adapter;
}

test("provider registry resolves default and explicit providers", () => {
  const stripeAdapter = createStubAdapter("stripe");
  const registry = createProviderRegistry({
    providers: [stripeAdapter],
    defaultProvider: "stripe",
    validateProvider: (adapter) => assertProviderAdapter(adapter),
    providerRequiredMessage: "Billing provider is required.",
    duplicateProviderMessage: (provider) => `Billing provider already registered: ${provider}.`,
    unsupportedProviderMessage: (provider) => `Unsupported billing provider: ${provider}.`
  });

  assert.equal(registry.getDefaultProvider(), "stripe");
  assert.equal(registry.resolveProvider(), stripeAdapter);
  assert.equal(registry.resolveProvider("STRIPE"), stripeAdapter);
  assert.equal(registry.hasProvider("stripe"), true);

  const manualAdapter = createStubAdapter("manual");
  registry.registerProvider(manualAdapter);
  assert.equal(registry.resolveProvider("manual"), manualAdapter);
  assert.deepEqual(registry.listProviders(), ["stripe", "manual"]);
});

test("provider registry rejects duplicate and unknown providers with explicit errors", () => {
  const registry = createProviderRegistry({
    providers: [createStubAdapter("stripe")],
    validateProvider: (adapter) => assertProviderAdapter(adapter),
    duplicateProviderMessage: (provider) => `Billing provider already registered: ${provider}.`,
    unsupportedProviderMessage: (provider) => `Unsupported billing provider: ${provider}.`
  });

  assert.throws(() => registry.registerProvider(createStubAdapter("stripe")), /Billing provider already registered: stripe/);
  assert.throws(() => registry.resolveProvider("unknown"), /Unsupported billing provider: unknown/);
});
