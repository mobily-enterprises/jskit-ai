import {
  PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  isBillingProviderError,
  createBillingProviderError,
  normalizeProviderErrorCategory
} from "@jskit-ai/billing-provider-core";

const BILLING_PROVIDER_ERROR_CATEGORIES = PROVIDER_ERROR_CATEGORIES;

export {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  isBillingProviderError,
  createBillingProviderError,
  normalizeProviderErrorCategory
};
