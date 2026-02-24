import {
  createProviderRegistry,
  assertProviderAdapter,
  normalizeProviderCode
} from "@jskit-ai/billing-provider-core";

function createService({ adapters = [], defaultProvider = "" } = {}) {
  const providerRegistry = createProviderRegistry({
    providers: adapters,
    defaultProvider,
    normalizeProvider: normalizeProviderCode,
    validateProvider: (adapter) => assertProviderAdapter(adapter, { name: "billingProviderAdapter" }),
    providerRequiredMessage: "Billing provider is required.",
    unsupportedProviderMessage: (provider) => `Unsupported billing provider: ${provider}.`,
    duplicateProviderMessage: (provider) => `Billing provider already registered: ${provider}.`
  });

  return {
    registerAdapter(adapter) {
      return providerRegistry.registerProvider(adapter);
    },
    resolveProvider(provider = providerRegistry.getDefaultProvider()) {
      return providerRegistry.resolveProvider(provider);
    },
    hasProvider(provider) {
      return providerRegistry.hasProvider(provider);
    },
    listProviders() {
      return providerRegistry.listProviders();
    },
    getDefaultProvider() {
      return providerRegistry.getDefaultProvider();
    }
  };
}

export { createService };
