import { createBillingCatalogProviderPricingCore } from "@jskit-ai/billing-core/providerPricingCore";
import { AppError } from "../../../lib/errors.js";

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
