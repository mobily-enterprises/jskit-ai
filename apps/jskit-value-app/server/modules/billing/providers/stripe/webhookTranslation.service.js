import { BILLING_PROVIDER_STRIPE } from "../../constants.js";
import {
  assertBillingWebhookTranslator,
  shouldProcessCanonicalBillingWebhookEvent
} from "../shared/webhookTranslation.contract.js";

function createService() {
  const translator = {
    provider: BILLING_PROVIDER_STRIPE,
    toCanonicalEvent(providerEvent) {
      return providerEvent && typeof providerEvent === "object" ? providerEvent : {};
    },
    supportsCanonicalEventType(eventType) {
      return shouldProcessCanonicalBillingWebhookEvent(eventType);
    }
  };

  return assertBillingWebhookTranslator(translator, {
    name: "stripeBillingWebhookTranslator"
  });
}

export { createService };
