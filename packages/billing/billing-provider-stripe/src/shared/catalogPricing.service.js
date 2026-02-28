import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";

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

function resolveErrorFactory(createError) {
  return typeof createError === "function" ? createError : createDefaultError;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function parseNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function toValidationError(createError, fieldPath, message) {
  return createError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        [fieldPath]: String(message || "Invalid value.")
      }
    }
  });
}

async function resolveStripeCatalogPriceSnapshot({
  retrievePrice,
  providerPriceId,
  fallbackProviderProductId = null,
  fieldPath,
  createError,
  requireRecurring
} = {}) {
  const normalizedProviderPriceId = normalizeText(providerPriceId);
  if (!normalizedProviderPriceId) {
    throw toValidationError(createError, fieldPath, `${fieldPath} is required.`);
  }

  if (typeof retrievePrice !== "function") {
    throw createError(501, "Stripe price verification is not available.");
  }

  let price;
  try {
    price = await retrievePrice({
      priceId: normalizedProviderPriceId
    });
  } catch (error) {
    const status = Number(error?.httpStatus || error?.statusCode || error?.status || 0);
    if (status === 400 || status === 404) {
      throw toValidationError(createError, fieldPath, "Stripe price not found.");
    }
    throw error;
  }

  if (!price || typeof price !== "object" || !normalizeText(price.id)) {
    throw toValidationError(createError, fieldPath, "Stripe price not found.");
  }

  if (price.active !== true) {
    throw toValidationError(createError, fieldPath, "Stripe price must be active.");
  }

  const currency = normalizeText(price.currency).toUpperCase();
  if (!currency || currency.length !== 3) {
    throw toValidationError(createError, fieldPath, "Stripe price currency is invalid.");
  }

  const unitAmountMinor = parseNonNegativeInteger(price.unitAmountMinor);
  if (unitAmountMinor == null) {
    throw toValidationError(createError, fieldPath, "Stripe price amount is invalid.");
  }

  const interval = normalizeText(price.interval).toLowerCase() || null;
  const intervalCount = interval ? parsePositiveInteger(price.intervalCount) : null;

  if (requireRecurring === true) {
    if (!interval || intervalCount == null) {
      throw toValidationError(createError, fieldPath, "Stripe price must be recurring.");
    }
    if (interval !== "month" || intervalCount !== 1) {
      throw toValidationError(createError, fieldPath, "Stripe core plan price must be monthly.");
    }

    const usageType = normalizeText(price.usageType).toLowerCase() || "licensed";
    if (usageType !== "licensed") {
      throw toValidationError(createError, fieldPath, "Stripe core plan price must be licensed.");
    }
  }

  if (requireRecurring === false) {
    if (interval && intervalCount == null) {
      throw toValidationError(createError, fieldPath, "Stripe recurring price intervalCount is invalid.");
    }
    if (interval) {
      throw toValidationError(
        createError,
        fieldPath,
        "Stripe product catalog price must be one-time. Recurring prices belong in billing plans."
      );
    }
  }

  const providerProductId = normalizeText(price.productId) || normalizeText(fallbackProviderProductId) || null;

  return {
    providerPriceId: normalizeText(price.id),
    providerProductId,
    currency,
    unitAmountMinor,
    interval,
    intervalCount
  };
}

function createService({ retrievePrice } = {}) {
  async function resolveCatalogCorePriceForCreate({ corePrice, createError } = {}) {
    const normalizedCorePrice = corePrice && typeof corePrice === "object" ? corePrice : null;
    if (!normalizedCorePrice) {
      return null;
    }

    const snapshot = await resolveStripeCatalogPriceSnapshot({
      retrievePrice,
      providerPriceId: normalizedCorePrice.providerPriceId,
      fallbackProviderProductId: normalizedCorePrice.providerProductId,
      fieldPath: "corePrice.providerPriceId",
      createError: resolveErrorFactory(createError),
      requireRecurring: true
    });

    return {
      ...normalizedCorePrice,
      ...snapshot
    };
  }

  async function resolveCatalogCorePriceForUpdate({ corePrice, createError } = {}) {
    return resolveCatalogCorePriceForCreate({ corePrice, createError });
  }

  async function resolveCatalogProductPriceForCreate({ price, createError } = {}) {
    const normalizedPrice = price && typeof price === "object" ? price : null;
    if (!normalizedPrice) {
      return price;
    }

    const snapshot = await resolveStripeCatalogPriceSnapshot({
      retrievePrice,
      providerPriceId: normalizedPrice.providerPriceId,
      fallbackProviderProductId: normalizedPrice.providerProductId,
      fieldPath: "price.providerPriceId",
      createError: resolveErrorFactory(createError),
      requireRecurring: false
    });

    return {
      ...normalizedPrice,
      ...snapshot
    };
  }

  async function resolveCatalogProductPriceForUpdate({ price, createError } = {}) {
    return resolveCatalogProductPriceForCreate({ price, createError });
  }

  return {
    resolveCatalogCorePriceForCreate,
    resolveCatalogCorePriceForUpdate,
    resolveCatalogProductPriceForCreate,
    resolveCatalogProductPriceForUpdate
  };
}

export { createService };
