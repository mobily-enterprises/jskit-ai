function createDefaultError(status, message, options = {}) {
  const error = new Error(String(message || "Request failed."));
  error.name = "AppError";
  error.status = Number(status) || 500;
  error.statusCode = error.status;
  error.code = options.code || "APP_ERROR";
  error.details = options.details;
  error.headers = options.headers || {};
  return error;
}

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
