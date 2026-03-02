import { createDefaultError } from "./pricingErrors.js";

function createBillingCatalogProviderPricingCore({ createError: createErrorOverride } = {}) {
  const createError = typeof createErrorOverride === "function" ? createErrorOverride : createDefaultError;

  async function resolveByProviderAdapter({ billingProviderAdapter, methodName, payload, fallbackValue }) {
    if (!billingProviderAdapter || typeof billingProviderAdapter[methodName] !== "function") {
      return fallbackValue;
    }

    return billingProviderAdapter[methodName]({
      ...(payload && typeof payload === "object" ? payload : {}),
      createError
    });
  }

  async function resolveCatalogCorePriceForCreate({ billingProviderAdapter, corePrice } = {}) {
    const fallbackValue = corePrice && typeof corePrice === "object" ? corePrice : null;
    return resolveByProviderAdapter({
      billingProviderAdapter,
      methodName: "resolveCatalogCorePriceForCreate",
      payload: { corePrice: fallbackValue },
      fallbackValue
    });
  }

  async function resolveCatalogCorePriceForUpdate({ billingProviderAdapter, corePrice } = {}) {
    const fallbackValue = corePrice && typeof corePrice === "object" ? corePrice : null;
    return resolveByProviderAdapter({
      billingProviderAdapter,
      methodName: "resolveCatalogCorePriceForUpdate",
      payload: { corePrice: fallbackValue },
      fallbackValue
    });
  }

  async function resolveCatalogProductPriceForCreate({ billingProviderAdapter, price } = {}) {
    return resolveByProviderAdapter({
      billingProviderAdapter,
      methodName: "resolveCatalogProductPriceForCreate",
      payload: { price },
      fallbackValue: price
    });
  }

  async function resolveCatalogProductPriceForUpdate({ billingProviderAdapter, price } = {}) {
    return resolveByProviderAdapter({
      billingProviderAdapter,
      methodName: "resolveCatalogProductPriceForUpdate",
      payload: { price },
      fallbackValue: price
    });
  }

  return {
    resolveCatalogCorePriceForCreate,
    resolveCatalogCorePriceForUpdate,
    resolveCatalogProductPriceForCreate,
    resolveCatalogProductPriceForUpdate
  };
}

export { createBillingCatalogProviderPricingCore };
