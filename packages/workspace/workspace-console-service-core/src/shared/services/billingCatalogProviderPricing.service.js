import { createBillingCatalogProviderPricingCore } from "@jskit-ai/billing-core/providerPricingCore";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

const billingCatalogProviderPricingCore = createBillingCatalogProviderPricingCore({
  createError(status, message, options = {}) {
    return new AppError(status, message, options);
  }
});

const {
  resolveStripeCatalogPriceSnapshot,
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate,
  resolveStripeCatalogProductPriceSnapshot,
  resolveCatalogProductPriceForCreate,
  resolveCatalogProductPriceForUpdate
} = billingCatalogProviderPricingCore;

export {
  resolveStripeCatalogPriceSnapshot,
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate,
  resolveStripeCatalogProductPriceSnapshot,
  resolveCatalogProductPriceForCreate,
  resolveCatalogProductPriceForUpdate
};
