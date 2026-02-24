import {
  createStripeSdkService,
  createStripeBillingProviderAdapterService,
  createStripeWebhookTranslationService
} from "@jskit-ai/billing-provider-stripe";
import {
  createPaddleSdkService,
  createPaddleBillingProviderAdapterService,
  createPaddleWebhookTranslationService
} from "@jskit-ai/billing-provider-paddle";
import { createService as createBillingProviderRegistryService } from "./shared/providerRegistry.service.js";
import { createService as createBillingWebhookTranslationRegistryService } from "./shared/webhookTranslationRegistry.service.js";

function createService({ enabled = false, defaultProvider = "", stripe = {}, paddle = {} } = {}) {
  const stripeSdkService = createStripeSdkService({
    enabled,
    ...stripe
  });
  const paddleSdkService = createPaddleSdkService({
    enabled,
    ...paddle
  });

  const stripeBillingProviderAdapter = createStripeBillingProviderAdapterService({
    stripeSdkService
  });
  const paddleBillingProviderAdapter = createPaddleBillingProviderAdapterService({
    paddleSdkService
  });

  const billingProviderRegistryService = createBillingProviderRegistryService({
    adapters: [stripeBillingProviderAdapter, paddleBillingProviderAdapter],
    defaultProvider
  });

  const billingProviderAdapter = billingProviderRegistryService.resolveProvider(defaultProvider);

  const stripeBillingWebhookTranslator = createStripeWebhookTranslationService();
  const paddleBillingWebhookTranslator = createPaddleWebhookTranslationService();

  const billingWebhookTranslationRegistryService = createBillingWebhookTranslationRegistryService({
    translators: [stripeBillingWebhookTranslator, paddleBillingWebhookTranslator],
    defaultProvider
  });

  return {
    stripeSdkService,
    paddleSdkService,
    stripeBillingProviderAdapter,
    paddleBillingProviderAdapter,
    billingProviderRegistryService,
    billingProviderAdapter,
    stripeBillingWebhookTranslator,
    paddleBillingWebhookTranslator,
    billingWebhookTranslationRegistryService
  };
}

export { createService };
