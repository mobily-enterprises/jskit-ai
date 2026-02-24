import { BILLING_PROVIDER_PADDLE } from "@jskit-ai/billing-provider-core";
import {
  REQUIRED_PROVIDER_ADAPTER_METHODS,
  assertProviderAdapter
} from "@jskit-ai/billing-provider-core";

function createService({ paddleSdkService } = {}) {
  for (const methodName of REQUIRED_PROVIDER_ADAPTER_METHODS) {
    if (typeof paddleSdkService?.[methodName] !== "function") {
      throw new Error(`paddleSdkService.${methodName} is required.`);
    }
  }

  const adapter = {
    provider: BILLING_PROVIDER_PADDLE,
    async createCheckoutSession(payload) {
      return paddleSdkService.createCheckoutSession(payload);
    },
    async createPaymentLink(payload) {
      return paddleSdkService.createPaymentLink(payload);
    },
    async createPrice(payload) {
      return paddleSdkService.createPrice(payload);
    },
    async createBillingPortalSession(payload) {
      return paddleSdkService.createBillingPortalSession(payload);
    },
    async verifyWebhookEvent(payload) {
      return paddleSdkService.verifyWebhookEvent(payload);
    },
    async retrieveCheckoutSession(payload) {
      return paddleSdkService.retrieveCheckoutSession(payload);
    },
    async retrieveSubscription(payload) {
      return paddleSdkService.retrieveSubscription(payload);
    },
    async retrieveInvoice(payload) {
      return paddleSdkService.retrieveInvoice(payload);
    },
    async expireCheckoutSession(payload) {
      return paddleSdkService.expireCheckoutSession(payload);
    },
    async cancelSubscription(payload) {
      return paddleSdkService.cancelSubscription(payload);
    },
    async updateSubscriptionPlan(payload) {
      return paddleSdkService.updateSubscriptionPlan(payload);
    },
    async listCustomerPaymentMethods(payload) {
      return paddleSdkService.listCustomerPaymentMethods(payload);
    },
    async listCheckoutSessionsByOperationKey(payload) {
      return paddleSdkService.listCheckoutSessionsByOperationKey(payload);
    },
    async getSdkProvenance(payload) {
      return paddleSdkService.getSdkProvenance(payload);
    }
  };

  return assertProviderAdapter(adapter, { name: "paddleBillingProviderAdapter" });
}

export { createService };
