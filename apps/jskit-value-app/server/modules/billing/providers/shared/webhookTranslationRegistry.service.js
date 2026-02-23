import { assertBillingWebhookTranslator, normalizeBillingWebhookProvider } from "./webhookTranslation.contract.js";

function createService({ translators = [], defaultProvider = "" } = {}) {
  const translatorByProvider = new Map();
  let resolvedDefaultProvider = normalizeBillingWebhookProvider(defaultProvider);

  function registerTranslator(translator) {
    const validTranslator = assertBillingWebhookTranslator(translator);
    const provider = normalizeBillingWebhookProvider(validTranslator.provider);
    if (translatorByProvider.has(provider)) {
      throw new Error(`Billing webhook translator already registered: ${provider}.`);
    }
    translatorByProvider.set(provider, validTranslator);

    if (!resolvedDefaultProvider) {
      resolvedDefaultProvider = provider;
    }

    return validTranslator;
  }

  if (Array.isArray(translators)) {
    for (const translator of translators) {
      registerTranslator(translator);
    }
  }

  function resolveProvider(provider = resolvedDefaultProvider) {
    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (!normalizedProvider) {
      throw new Error("Billing webhook translator provider is required.");
    }

    const translator = translatorByProvider.get(normalizedProvider);
    if (!translator) {
      throw new Error(`Unsupported billing webhook translator provider: ${normalizedProvider}.`);
    }

    return translator;
  }

  function hasProvider(provider) {
    const normalizedProvider = normalizeBillingWebhookProvider(provider);
    if (!normalizedProvider) {
      return false;
    }

    return translatorByProvider.has(normalizedProvider);
  }

  function listProviders() {
    return Array.from(translatorByProvider.keys());
  }

  return {
    registerTranslator,
    resolveProvider,
    hasProvider,
    listProviders,
    getDefaultProvider() {
      return resolvedDefaultProvider;
    }
  };
}

export { createService };
