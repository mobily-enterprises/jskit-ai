import { assertContractCandidate, normalizeProviderCode, validateContractCandidate } from "../validation.js";

const REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed"
]);

const REQUIRED_WEBHOOK_TRANSLATOR_METHODS = Object.freeze(["toCanonicalEvent", "supportsCanonicalEventType"]);

function normalizeWebhookProvider(value) {
  return normalizeProviderCode(value);
}

function shouldProcessCanonicalWebhookEvent(eventType) {
  const normalizedEventType = String(eventType || "").trim();
  if (!normalizedEventType) {
    return false;
  }

  return REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES.has(normalizedEventType);
}

function validateWebhookTranslator(translator) {
  return validateContractCandidate(translator, {
    requiredMethods: REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
    normalizeProvider: normalizeWebhookProvider
  });
}

function assertWebhookTranslator(translator, { name = "webhookTranslator" } = {}) {
  return assertContractCandidate(translator, {
    name,
    validationLabel: "billing webhook translator",
    requiredMethods: REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
    normalizeProvider: normalizeWebhookProvider
  });
}

export {
  REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  normalizeWebhookProvider,
  shouldProcessCanonicalWebhookEvent,
  validateWebhookTranslator,
  assertWebhookTranslator
};
