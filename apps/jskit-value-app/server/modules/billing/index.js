import * as billingRepository from "./repository.js";

function createRepository() {
  return billingRepository;
}

export { createRepository, billingRepository };
export { createService as createBillingProvidersModule } from "./lib/providers/index.js";
export {
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  normalizeProviderCode,
  validateProviderAdapter,
  assertProviderAdapter
} from "./lib/providers/shared/providerAdapter.contract.js";
export {
  PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  isBillingProviderError,
  createBillingProviderError,
  normalizeProviderErrorCategory
} from "./lib/providers/shared/providerError.contract.js";
export {
  REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  normalizeWebhookProvider,
  shouldProcessCanonicalWebhookEvent,
  validateWebhookTranslator,
  assertWebhookTranslator
} from "./lib/providers/shared/webhookTranslation.contract.js";
export { createService as createBillingProviderRegistryService } from "./lib/providers/shared/providerRegistry.service.js";
export { createService as createBillingWebhookTranslationRegistryService } from "./lib/providers/shared/webhookTranslationRegistry.service.js";
