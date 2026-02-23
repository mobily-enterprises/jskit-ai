import { BILLING_PROVIDER_STRIPE } from "../../constants.js";
import {
  assertWebhookTranslator,
  shouldProcessCanonicalWebhookEvent
} from "../shared/webhookTranslation.contract.js";

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
