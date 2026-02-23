import {
  REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES,
  REQUIRED_WEBHOOK_TRANSLATOR_METHODS,
  normalizeWebhookProvider,
  shouldProcessCanonicalWebhookEvent,
  validateWebhookTranslator,
  assertWebhookTranslator
} from "@jskit-ai/billing-provider-core";

const REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES = REQUIRED_CANONICAL_WEBHOOK_EVENT_TYPES;
const REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS = REQUIRED_WEBHOOK_TRANSLATOR_METHODS;
const normalizeBillingWebhookProvider = normalizeWebhookProvider;
const shouldProcessCanonicalBillingWebhookEvent = shouldProcessCanonicalWebhookEvent;
const validateBillingWebhookTranslator = validateWebhookTranslator;
const assertBillingWebhookTranslator = assertWebhookTranslator;

export {
  REQUIRED_CANONICAL_BILLING_WEBHOOK_EVENT_TYPES,
  REQUIRED_BILLING_WEBHOOK_TRANSLATOR_METHODS,
  normalizeBillingWebhookProvider,
  shouldProcessCanonicalBillingWebhookEvent,
  validateBillingWebhookTranslator,
  assertBillingWebhookTranslator
};
