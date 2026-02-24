import { BILLING_PROVIDER_STRIPE } from "@jskit-ai/billing-provider-core";
import {
  assertWebhookTranslator,
  shouldProcessCanonicalWebhookEvent
} from "@jskit-ai/billing-provider-core";

function createService() {
  const translator = {
    provider: BILLING_PROVIDER_STRIPE,
    toCanonicalEvent(providerEvent) {
      return providerEvent && typeof providerEvent === "object" ? providerEvent : {};
    },
    supportsCanonicalEventType(eventType) {
      return shouldProcessCanonicalWebhookEvent(eventType);
    }
  };

  return assertWebhookTranslator(translator, {
    name: "stripeBillingWebhookTranslator"
  });
}

export { createService };
