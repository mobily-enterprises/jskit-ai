import { assertContractCandidate, normalizeProviderCode, validateContractCandidate } from "../validation.js";

const REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS = Object.freeze([
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
  "setDefaultCustomerPaymentMethod",
  "detachCustomerPaymentMethod",
  "removeCustomerPaymentMethod",
  "refundPurchase",
  "voidPurchase",
  "listCheckoutSessionsByOperationKey",
  "getSdkProvenance"
]);

const REQUIRED_PROVIDER_ADAPTER_METHODS = Object.freeze([
  ...REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS,
  "resolveCatalogCorePriceForCreate",
  "resolveCatalogCorePriceForUpdate",
  "resolveCatalogProductPriceForCreate",
  "resolveCatalogProductPriceForUpdate"
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

export {
  REQUIRED_PROVIDER_ADAPTER_OPERATION_METHODS,
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  normalizeProviderCode,
  validateProviderAdapter,
  assertProviderAdapter
};
