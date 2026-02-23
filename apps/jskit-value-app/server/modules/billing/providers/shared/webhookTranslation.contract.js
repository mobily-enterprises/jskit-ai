const REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed"
]);

const REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS = Object.freeze([
  "toCanonicalEvent",
  "supportsCanonicalEventType"
]);

function normalizeBillingWebhookProvider(provider) {
  return String(provider || "")
    .trim()
    .toLowerCase();
}

function shouldProcessCanonicalBillingWebhookEvent(eventType) {
  const normalizedEventType = String(eventType || "").trim();
  if (!normalizedEventType) {
    return false;
  }

  return REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES.has(normalizedEventType);
}

function validateBillingWebhookTranslator(translator) {
  const candidate = translator && typeof translator === "object" ? translator : null;
  const provider = normalizeBillingWebhookProvider(candidate?.provider);
  const missingFields = [];
  const missingMethods = [];

  if (!provider) {
    missingFields.push("provider");
  }

  for (const methodName of REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS) {
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

function assertBillingWebhookTranslator(translator, { name = "billingWebhookTranslator" } = {}) {
  const validation = validateBillingWebhookTranslator(translator);
  if (validation.valid) {
    return translator;
  }

  const missing = [
    ...validation.missingFields.map((fieldName) => `${name}.${fieldName}`),
    ...validation.missingMethods.map((methodName) => `${name}.${methodName}`)
  ];
  throw new Error(`Invalid billing webhook translator: missing ${missing.join(", ")}.`);
}

export {
  REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES,
  REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS,
  normalizeBillingWebhookProvider,
  shouldProcessCanonicalBillingWebhookEvent,
  validateBillingWebhookTranslator,
  assertBillingWebhookTranslator
};
