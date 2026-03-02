import {
  createProviderRegistry,
  assertWebhookTranslator,
  normalizeWebhookProvider
} from "@jskit-ai/billing-provider-core/server";

function createService({ translators = [], defaultProvider = "" } = {}) {
  const translatorRegistry = createProviderRegistry({
    providers: translators,
    defaultProvider,
    normalizeProvider: normalizeWebhookProvider,
    validateProvider: (translator) =>
      assertWebhookTranslator(translator, {
        name: "billingWebhookTranslator"
      }),
    providerRequiredMessage: "Billing webhook translator provider is required.",
    unsupportedProviderMessage: (provider) => `Unsupported billing webhook translator provider: ${provider}.`,
    duplicateProviderMessage: (provider) => `Billing webhook translator already registered: ${provider}.`
  });

  return {
    registerTranslator(translator) {
      return translatorRegistry.registerProvider(translator);
    },
    resolveProvider(provider = translatorRegistry.getDefaultProvider()) {
      return translatorRegistry.resolveProvider(provider);
    },
    hasProvider(provider) {
      return translatorRegistry.hasProvider(provider);
    },
    listProviders() {
      return translatorRegistry.listProviders();
    },
    getDefaultProvider() {
      return translatorRegistry.getDefaultProvider();
    }
  };
}

export { createService };
