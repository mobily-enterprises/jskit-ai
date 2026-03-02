import { BILLING_PROVIDER_STRIPE, assertProviderAdapter } from "@jskit-ai/billing-provider-core/server";
import { createService as createStripeCatalogPricingService } from "./catalogPricing.service.js";

const REQUIRED_STRIPE_SDK_METHODS = Object.freeze([
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

const CATALOG_PRICING_METHODS = Object.freeze([
  "resolveCatalogCorePriceForCreate",
  "resolveCatalogCorePriceForUpdate",
  "resolveCatalogProductPriceForCreate",
  "resolveCatalogProductPriceForUpdate"
]);

function createService({ stripeSdkService } = {}) {
  for (const methodName of REQUIRED_STRIPE_SDK_METHODS) {
    if (typeof stripeSdkService?.[methodName] !== "function") {
      throw new Error(`stripeSdkService.${methodName} is required.`);
    }
  }

  const hasSdkCatalogPricingMethods = CATALOG_PRICING_METHODS.every(
    (methodName) => typeof stripeSdkService?.[methodName] === "function"
  );
  if (!hasSdkCatalogPricingMethods && typeof stripeSdkService?.retrievePrice !== "function") {
    throw new Error("stripeSdkService.retrievePrice is required.");
  }

  const catalogPricingService = createStripeCatalogPricingService({
    retrievePrice(payload) {
      return stripeSdkService.retrievePrice(payload);
    }
  });

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
    async setSubscriptionCancelAtPeriodEnd(payload) {
      return stripeSdkService.setSubscriptionCancelAtPeriodEnd(payload);
    },
    async updateSubscriptionPlan(payload) {
      return stripeSdkService.updateSubscriptionPlan(payload);
    },
    async listCustomerPaymentMethods(payload) {
      return stripeSdkService.listCustomerPaymentMethods(payload);
    },
    async setDefaultCustomerPaymentMethod(payload) {
      return stripeSdkService.setDefaultCustomerPaymentMethod(payload);
    },
    async detachCustomerPaymentMethod(payload) {
      return stripeSdkService.detachCustomerPaymentMethod(payload);
    },
    async removeCustomerPaymentMethod(payload) {
      return stripeSdkService.removeCustomerPaymentMethod(payload);
    },
    async refundPurchase(payload) {
      return stripeSdkService.refundPurchase(payload);
    },
    async voidPurchase(payload) {
      return stripeSdkService.voidPurchase(payload);
    },
    async listCheckoutSessionsByOperationKey(payload) {
      return stripeSdkService.listCheckoutSessionsByOperationKey(payload);
    },
    async getSdkProvenance(payload) {
      return stripeSdkService.getSdkProvenance(payload);
    },
    async resolveCatalogCorePriceForCreate(payload) {
      if (typeof stripeSdkService.resolveCatalogCorePriceForCreate === "function") {
        return stripeSdkService.resolveCatalogCorePriceForCreate(payload);
      }
      return catalogPricingService.resolveCatalogCorePriceForCreate(payload);
    },
    async resolveCatalogCorePriceForUpdate(payload) {
      if (typeof stripeSdkService.resolveCatalogCorePriceForUpdate === "function") {
        return stripeSdkService.resolveCatalogCorePriceForUpdate(payload);
      }
      return catalogPricingService.resolveCatalogCorePriceForUpdate(payload);
    },
    async resolveCatalogProductPriceForCreate(payload) {
      if (typeof stripeSdkService.resolveCatalogProductPriceForCreate === "function") {
        return stripeSdkService.resolveCatalogProductPriceForCreate(payload);
      }
      return catalogPricingService.resolveCatalogProductPriceForCreate(payload);
    },
    async resolveCatalogProductPriceForUpdate(payload) {
      if (typeof stripeSdkService.resolveCatalogProductPriceForUpdate === "function") {
        return stripeSdkService.resolveCatalogProductPriceForUpdate(payload);
      }
      return catalogPricingService.resolveCatalogProductPriceForUpdate(payload);
    }
  };

  return assertProviderAdapter(adapter, { name: "stripeBillingProviderAdapter" });
}

export { createService };
