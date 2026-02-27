import { createRequire } from "node:module";
import { createService as createBillingProviderRegistryService } from "./shared/providerRegistry.service.js";
import { createService as createBillingWebhookTranslationRegistryService } from "./shared/webhookTranslationRegistry.service.js";

const requireFromModule = createRequire(import.meta.url);

const STRIPE_PROVIDER_MODULE_ID = "@jskit-ai/billing-provider-stripe";
const PADDLE_PROVIDER_MODULE_ID = "@jskit-ai/billing-provider-paddle";

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isMissingTopLevelModuleError(error, moduleId) {
  const code = String(error?.code || "").trim();
  if (code !== "MODULE_NOT_FOUND" && code !== "ERR_MODULE_NOT_FOUND") {
    return false;
  }

  const message = String(error?.message || "");
  return message.includes(`'${moduleId}'`) || message.includes(`"${moduleId}"`);
}

function loadOptionalProviderModule(moduleId) {
  try {
    return requireFromModule(moduleId);
  } catch (error) {
    if (isMissingTopLevelModuleError(error, moduleId)) {
      return null;
    }
    throw error;
  }
}

function resolveInstalledProviderIds(providerEntries) {
  return providerEntries.map((entry) => entry.id);
}

function resolveBillingProviderSelection({ enabled, configuredProviderId, installedProviderIds }) {
  if (!enabled) {
    if (configuredProviderId && installedProviderIds.includes(configuredProviderId)) {
      return configuredProviderId;
    }
    if (installedProviderIds.length === 1) {
      return installedProviderIds[0];
    }
    return null;
  }

  if (installedProviderIds.length < 1) {
    throw new Error(
      [
        "Billing is enabled but no billing provider package is installed.",
        `Install one of: ${STRIPE_PROVIDER_MODULE_ID}, ${PADDLE_PROVIDER_MODULE_ID}.`
      ].join(" ")
    );
  }

  if (configuredProviderId && !installedProviderIds.includes(configuredProviderId)) {
    throw new Error(
      `Configured billing provider "${configuredProviderId}" is not installed. Installed providers: ${installedProviderIds.join(", ")}.`
    );
  }

  if (!configuredProviderId && installedProviderIds.length > 1) {
    throw new Error(
      `Billing provider is ambiguous. Configure billing.provider to one of: ${installedProviderIds.join(", ")}.`
    );
  }

  return configuredProviderId || installedProviderIds[0];
}

function createService({ enabled = false, defaultProvider = "", stripe = {}, paddle = {} } = {}) {
  const stripeProviderModule = loadOptionalProviderModule(STRIPE_PROVIDER_MODULE_ID);
  const paddleProviderModule = loadOptionalProviderModule(PADDLE_PROVIDER_MODULE_ID);

  const stripeSdkService =
    stripeProviderModule?.createStripeSdkService?.({
      enabled,
      ...stripe
    }) || null;
  const paddleSdkService =
    paddleProviderModule?.createPaddleSdkService?.({
      enabled,
      ...paddle
    }) || null;

  const stripeBillingProviderAdapter =
    stripeProviderModule?.createStripeBillingProviderAdapterService?.({
      stripeSdkService
    }) || null;
  const paddleBillingProviderAdapter =
    paddleProviderModule?.createPaddleBillingProviderAdapterService?.({
      paddleSdkService
    }) || null;

  const providerEntries = [];
  if (stripeBillingProviderAdapter) {
    providerEntries.push({
      id: "stripe",
      adapter: stripeBillingProviderAdapter
    });
  }
  if (paddleBillingProviderAdapter) {
    providerEntries.push({
      id: "paddle",
      adapter: paddleBillingProviderAdapter
    });
  }

  const installedProviderIds = resolveInstalledProviderIds(providerEntries);
  const configuredProviderId = normalizeProviderId(defaultProvider);
  const selectedProviderId = resolveBillingProviderSelection({
    enabled: enabled === true,
    configuredProviderId,
    installedProviderIds
  });

  const billingProviderRegistryService = createBillingProviderRegistryService({
    adapters: providerEntries.map((entry) => entry.adapter),
    defaultProvider: selectedProviderId || configuredProviderId || ""
  });

  const billingProviderAdapter = selectedProviderId
    ? billingProviderRegistryService.resolveProvider(selectedProviderId)
    : null;

  const stripeBillingWebhookTranslator = stripeProviderModule?.createStripeWebhookTranslationService?.() || null;
  const paddleBillingWebhookTranslator = paddleProviderModule?.createPaddleWebhookTranslationService?.() || null;

  const billingWebhookTranslationRegistryService = createBillingWebhookTranslationRegistryService({
    translators: [stripeBillingWebhookTranslator, paddleBillingWebhookTranslator].filter(Boolean),
    defaultProvider: selectedProviderId || configuredProviderId || ""
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
