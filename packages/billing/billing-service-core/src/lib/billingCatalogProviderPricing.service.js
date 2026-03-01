import { createBillingCatalogProviderPricingCore } from "@jskit-ai/billing-core/providerPricingCore";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

const billingCatalogProviderPricingCore = createBillingCatalogProviderPricingCore({
  createError(status, message, options = {}) {
    return new AppError(status, message, options);
  }
});

const {
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate,
  resolveCatalogProductPriceForCreate,
  resolveCatalogProductPriceForUpdate
} = billingCatalogProviderPricingCore;

export {
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate,
  resolveCatalogProductPriceForCreate,
  resolveCatalogProductPriceForUpdate
};
