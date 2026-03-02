import { BILLING_PROVIDER_PADDLE, assertProviderAdapter } from "@jskit-ai/billing-provider-core/server";
import { createService as createPaddleCatalogPricingService } from "./catalogPricing.service.js";

const REQUIRED_PADDLE_SDK_METHODS = Object.freeze([
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
  "updateSubscriptionPlan",
  "listCustomerPaymentMethods",
  "setDefaultCustomerPaymentMethod",
  "detachCustomerPaymentMethod",
  "removeCustomerPaymentMethod",
  "refundPurchase",
  "voidPurchase",
  "listCheckoutSessionsByOperationKey",
  "getSdkProvenance"
]);

function createService({ paddleSdkService } = {}) {
  for (const methodName of REQUIRED_PADDLE_SDK_METHODS) {
    if (typeof paddleSdkService?.[methodName] !== "function") {
      throw new Error(`paddleSdkService.${methodName} is required.`);
    }
  }

  const catalogPricingService = createPaddleCatalogPricingService();

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
    async setDefaultCustomerPaymentMethod(payload) {
      return paddleSdkService.setDefaultCustomerPaymentMethod(payload);
    },
    async detachCustomerPaymentMethod(payload) {
      return paddleSdkService.detachCustomerPaymentMethod(payload);
    },
    async removeCustomerPaymentMethod(payload) {
      return paddleSdkService.removeCustomerPaymentMethod(payload);
    },
    async refundPurchase(payload) {
      return paddleSdkService.refundPurchase(payload);
    },
    async voidPurchase(payload) {
      return paddleSdkService.voidPurchase(payload);
    },
    async listCheckoutSessionsByOperationKey(payload) {
      return paddleSdkService.listCheckoutSessionsByOperationKey(payload);
    },
    async getSdkProvenance(payload) {
      return paddleSdkService.getSdkProvenance(payload);
    },
    async resolveCatalogCorePriceForCreate(payload) {
      if (typeof paddleSdkService.resolveCatalogCorePriceForCreate === "function") {
        return paddleSdkService.resolveCatalogCorePriceForCreate(payload);
      }
      return catalogPricingService.resolveCatalogCorePriceForCreate(payload);
    },
    async resolveCatalogCorePriceForUpdate(payload) {
      if (typeof paddleSdkService.resolveCatalogCorePriceForUpdate === "function") {
        return paddleSdkService.resolveCatalogCorePriceForUpdate(payload);
      }
      return catalogPricingService.resolveCatalogCorePriceForUpdate(payload);
    },
    async resolveCatalogProductPriceForCreate(payload) {
      if (typeof paddleSdkService.resolveCatalogProductPriceForCreate === "function") {
        return paddleSdkService.resolveCatalogProductPriceForCreate(payload);
      }
      return catalogPricingService.resolveCatalogProductPriceForCreate(payload);
    },
    async resolveCatalogProductPriceForUpdate(payload) {
      if (typeof paddleSdkService.resolveCatalogProductPriceForUpdate === "function") {
        return paddleSdkService.resolveCatalogProductPriceForUpdate(payload);
      }
      return catalogPricingService.resolveCatalogProductPriceForUpdate(payload);
    }
  };

  return assertProviderAdapter(adapter, { name: "paddleBillingProviderAdapter" });
}

export { createService };
