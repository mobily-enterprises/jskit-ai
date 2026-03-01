import { normalizeProviderCode } from "./validation.js";

function createProviderRegistry({
  providers = [],
  defaultProvider = "",
  normalizeProvider = normalizeProviderCode,
  validateProvider = null,
  providerRequiredMessage = "Billing provider is required.",
  unsupportedProviderMessage = (provider) => `Unsupported billing provider: ${provider}.`,
  duplicateProviderMessage = (provider) => `Billing provider already registered: ${provider}.`
} = {}) {
  const providerByCode = new Map();
  let resolvedDefaultProvider = normalizeProvider(defaultProvider);

  function registerProvider(providerEntry) {
    const validEntry =
      typeof validateProvider === "function" ? validateProvider(providerEntry) : providerEntry;
    const provider = normalizeProvider(validEntry?.provider);

    if (!provider) {
      throw new Error(providerRequiredMessage);
    }

    if (providerByCode.has(provider)) {
      const errorMessage =
        typeof duplicateProviderMessage === "function"
          ? duplicateProviderMessage(provider)
          : String(duplicateProviderMessage || "");
      throw new Error(errorMessage || `Billing provider already registered: ${provider}.`);
    }

    providerByCode.set(provider, validEntry);

    if (!resolvedDefaultProvider) {
      resolvedDefaultProvider = provider;
    }

    return validEntry;
  }

  if (Array.isArray(providers)) {
    for (const providerEntry of providers) {
      registerProvider(providerEntry);
    }
  }

  function resolveProvider(provider = resolvedDefaultProvider) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) {
      throw new Error(providerRequiredMessage);
    }

    const entry = providerByCode.get(normalizedProvider);
    if (!entry) {
      const errorMessage =
        typeof unsupportedProviderMessage === "function"
          ? unsupportedProviderMessage(normalizedProvider)
          : String(unsupportedProviderMessage || "");
      throw new Error(errorMessage || `Unsupported billing provider: ${normalizedProvider}.`);
    }

    return entry;
  }

  function hasProvider(provider) {
    const normalizedProvider = normalizeProvider(provider);
    if (!normalizedProvider) {
      return false;
    }

    return providerByCode.has(normalizedProvider);
  }

  function listProviders() {
    return Array.from(providerByCode.keys());
  }

  return {
    registerProvider,
    resolveProvider,
    hasProvider,
    listProviders,
    getDefaultProvider() {
      return resolvedDefaultProvider;
    }
  };
}

export { createProviderRegistry };
