const REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS = Object.freeze([
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
  "listCustomerPaymentMethods",
  "listCheckoutSessionsByOperationKey",
  "getSdkProvenance"
]);

function normalizeBillingProviderCode(provider) {
  return String(provider || "")
    .trim()
    .toLowerCase();
}

function validateBillingProviderAdapter(adapter) {
  const candidate = adapter && typeof adapter === "object" ? adapter : null;
  const provider = normalizeBillingProviderCode(candidate?.provider);
  const missingFields = [];
  const missingMethods = [];

  if (!provider) {
    missingFields.push("provider");
  }

  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    if (typeof candidate?.[methodName] !== "function") {
      missingMethods.push(methodName);
    }
  }

  return {
    valid: missingFields.length === 0 && missingMethods.length === 0,
    provider,
    missingFields,
    missingMethods
  };
}

function assertBillingProviderAdapter(adapter, { name = "billingProviderAdapter" } = {}) {
  const validation = validateBillingProviderAdapter(adapter);
  if (validation.valid) {
    return adapter;
  }

  const missing = [
    ...validation.missingFields.map((fieldName) => `${name}.${fieldName}`),
    ...validation.missingMethods.map((methodName) => `${name}.${methodName}`)
  ];
  throw new Error(`Invalid billing provider adapter: missing ${missing.join(", ")}.`);
}

export {
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  normalizeBillingProviderCode,
  validateBillingProviderAdapter,
  assertBillingProviderAdapter
};
