import { BILLING_PROVIDER_STRIPE } from "../../constants.js";
import {
  REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS,
  assertBillingProviderAdapter
} from "../shared/providerAdapter.contract.js";

function createService({ stripeSdkService } = {}) {
  for (const methodName of REQUIRED_BILLING_PROVIDER_ADAPTER_METHODS) {
    if (typeof stripeSdkService?.[methodName] !== "function") {
      throw new Error(`stripeSdkService.${methodName} is required.`);
    }
  }

  const adapter = {
    provider: BILLING_PROVIDER_STRIPE,
    async createCheckoutSession(payload) {
      return stripeSdkService.createCheckoutSession(payload);
    },
    async createPaymentLink(payload) {
      return stripeSdkService.createPaymentLink(payload);
    },
    async createPrice(payload) {
      return stripeSdkService.createPrice(payload);
    },
    async listPrices(payload) {
      return stripeSdkService.listPrices(payload);
    },
    async retrievePrice(payload) {
      return stripeSdkService.retrievePrice(payload);
    },
    async createBillingPortalSession(payload) {
      return stripeSdkService.createBillingPortalSession(payload);
    },
    async verifyWebhookEvent(payload) {
      return stripeSdkService.verifyWebhookEvent(payload);
    },
    async retrieveCheckoutSession(payload) {
      return stripeSdkService.retrieveCheckoutSession(payload);
    },
    async retrieveSubscription(payload) {
      return stripeSdkService.retrieveSubscription(payload);
    },
    async retrieveInvoice(payload) {
      return stripeSdkService.retrieveInvoice(payload);
    },
    async expireCheckoutSession(payload) {
      return stripeSdkService.expireCheckoutSession(payload);
    },
    async cancelSubscription(payload) {
      return stripeSdkService.cancelSubscription(payload);
    },
    async listCustomerPaymentMethods(payload) {
      return stripeSdkService.listCustomerPaymentMethods(payload);
    },
    async listCheckoutSessionsByOperationKey(payload) {
      return stripeSdkService.listCheckoutSessionsByOperationKey(payload);
    },
    async getSdkProvenance(payload) {
      return stripeSdkService.getSdkProvenance(payload);
    }
  };

  return assertBillingProviderAdapter(adapter, { name: "stripeBillingProviderAdapter" });
}

export { createService };
