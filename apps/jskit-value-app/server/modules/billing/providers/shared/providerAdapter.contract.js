import {
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  normalizeProviderCode,
  validateProviderAdapter,
  assertProviderAdapter
} from "@jskit-ai/billing-provider-core";

const REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS = REQUIRED_PROVIDER_ADAPTER_METHODS;
const normalizeBillingProviderCode = normalizeProviderCode;
const validateBillingProviderAdapter = validateProviderAdapter;
const assertBillingProviderAdapter = assertProviderAdapter;

export {
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  normalizeBillingProviderCode,
  validateBillingProviderAdapter,
  assertBillingProviderAdapter
};
