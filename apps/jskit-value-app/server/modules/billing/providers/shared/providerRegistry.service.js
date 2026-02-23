import { assertBillingProviderAdapter, normalizeBillingProviderCode } from "./providerAdapter.contract.js";

function createService({ adapters = [], defaultProvider = "" } = {}) {
  const adapterByProvider = new Map();
  let resolvedDefaultProvider = normalizeBillingProviderCode(defaultProvider);

  function registerAdapter(adapter) {
    const validAdapter = assertBillingProviderAdapter(adapter);
    const provider = normalizeBillingProviderCode(validAdapter.provider);
    if (adapterByProvider.has(provider)) {
      throw new Error(`Billing provider already registered: ${provider}.`);
    }
    adapterByProvider.set(provider, validAdapter);

    if (!resolvedDefaultProvider) {
      resolvedDefaultProvider = provider;
    }

    return validAdapter;
  }

  if (Array.isArray(adapters)) {
    for (const adapter of adapters) {
      registerAdapter(adapter);
    }
  }

  function resolveProvider(provider = resolvedDefaultProvider) {
    const normalizedProvider = normalizeBillingProviderCode(provider);
    if (!normalizedProvider) {
      throw new Error("Billing provider is required.");
    }

    const adapter = adapterByProvider.get(normalizedProvider);
    if (!adapter) {
      throw new Error(`Unsupported billing provider: ${normalizedProvider}.`);
    }

    return adapter;
  }

  function hasProvider(provider) {
    const normalizedProvider = normalizeBillingProviderCode(provider);
    if (!normalizedProvider) {
      return false;
    }
    return adapterByProvider.has(normalizedProvider);
  }

  function listProviders() {
    return Array.from(adapterByProvider.keys());
  }

  return {
    registerAdapter,
    resolveProvider,
    hasProvider,
    listProviders,
    getDefaultProvider() {
      return resolvedDefaultProvider;
    }
  };
}

export { createService };
