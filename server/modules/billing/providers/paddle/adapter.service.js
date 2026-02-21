import { BILLING_PROVIDER_PADDLE } from "../../constants.js";
import {
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  assertBillingProviderAdapter
} from "../shared/providerAdapter.contract.js";

function createService({ paddleSdkService } = {}) {
  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
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

  return assertBillingProviderAdapter(adapter, { name: "paddleBillingProviderAdapter" });
}

export { createService };
