import { assertContractCandidate, normalizeProviderCode, validateContractCandidate } from "../validation.js";

const REQUIRED_PROVIDER_ADAPTER_METHODS = Object.freeze([
  "createCheckoutSession",
  "createPaymentLink",
  "createPrice",
  "createBillingPortalSession",
  "verifyWebhookEvent",
  "retrieveCheckoutSession",
  "retrieveSubscription",
  "retrieveInvoice",
  "expireCheckoutSession",
  "cancelSubscription",
  "updateSubscriptionPlan",
  "listCustomerPaymentMethods",
  "listCheckoutSessionsByOperationKey",
  "getSdkProvenance"
]);

function validateProviderAdapter(adapter) {
  return validateContractCandidate(adapter, {
    requiredMethods: REQUIRED_PROVIDER_ADAPTER_METHODS,
    normalizeProvider: normalizeProviderCode
  });
}

function assertProviderAdapter(adapter, { name = "providerAdapter" } = {}) {
  return assertContractCandidate(adapter, {
    name,
    validationLabel: "billing provider adapter",
    requiredMethods: REQUIRED_PROVIDER_ADAPTER_METHODS,
    normalizeProvider: normalizeProviderCode
  });
}

const REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS = REQUIRED_PROVIDER_ADAPTER_METHODS;
const normalizeBillingProviderCode = normalizeProviderCode;
const validateBillingProviderAdapter = validateProviderAdapter;
const assertBillingProviderAdapter = assertProviderAdapter;

export {
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  normalizeProviderCode,
  validateProviderAdapter,
  assertProviderAdapter,
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  normalizeBillingProviderCode,
  validateBillingProviderAdapter,
  assertBillingProviderAdapter
};
