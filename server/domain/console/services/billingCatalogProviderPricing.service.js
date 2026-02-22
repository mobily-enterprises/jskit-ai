import { AppError } from "../../../lib/errors.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function toValidationError(fieldPath, message) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        [fieldPath]: String(message || "Invalid value.")
      }
    }
  });
}

function parseNonNegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

async function resolveStripeCatalogPriceSnapshot({
  billingProviderAdapter,
  providerPriceId,
  fallbackProviderProductId = null,
  fieldPath = "corePrice.providerPriceId"
} = {}) {
  const normalizedProviderPriceId = normalizeText(providerPriceId);
  if (!normalizedProviderPriceId) {
    throw toValidationError(fieldPath, `${fieldPath} is required.`);
  }

  if (!billingProviderAdapter || typeof billingProviderAdapter.retrievePrice !== "function") {
    throw new AppError(501, "Stripe price verification is not available.");
  }

  let price;
  try {
    price = await billingProviderAdapter.retrievePrice({
      priceId: normalizedProviderPriceId
    });
  } catch (error) {
    const status = Number(error?.httpStatus || error?.statusCode || error?.status || 0);
    if (status === 400 || status === 404) {
      throw toValidationError(fieldPath, "Stripe price not found.");
    }
    throw error;
  }

  if (!price || typeof price !== "object" || !normalizeText(price.id)) {
    throw toValidationError(fieldPath, "Stripe price not found.");
  }

  if (price.active !== true) {
    throw toValidationError(fieldPath, "Stripe price must be active.");
  }

  const currency = normalizeText(price.currency).toUpperCase();
  if (!currency || currency.length !== 3) {
    throw toValidationError(fieldPath, "Stripe price currency is invalid.");
  }

  const unitAmountMinor = parseNonNegativeInteger(price.unitAmountMinor);
  if (unitAmountMinor == null) {
    throw toValidationError(fieldPath, "Stripe price amount is invalid.");
  }

  const interval = normalizeText(price.interval).toLowerCase();
  const intervalCount = parsePositiveInteger(price.intervalCount);
  if (!interval || intervalCount == null) {
    throw toValidationError(fieldPath, "Stripe price must be recurring.");
  }
  if (interval !== "month" || intervalCount !== 1) {
    throw toValidationError(fieldPath, "Stripe core plan price must be monthly.");
  }

  const usageType = normalizeText(price.usageType).toLowerCase() || "licensed";
  if (usageType !== "licensed") {
    throw toValidationError(fieldPath, "Stripe core plan price must be licensed.");
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

async function resolveCatalogCorePriceForCreate({
  activeBillingProvider,
  billingProviderAdapter,
  corePrice
} = {}) {
  const normalizedProvider = normalizeText(activeBillingProvider).toLowerCase();
  if (normalizedProvider === "stripe") {
    const stripeSnapshot = await resolveStripeCatalogPriceSnapshot({
      billingProviderAdapter,
      providerPriceId: corePrice?.providerPriceId,
      fallbackProviderProductId: corePrice?.providerProductId,
      fieldPath: "corePrice.providerPriceId"
    });
    return {
      ...corePrice,
      ...stripeSnapshot
    };
  }

  return corePrice;
}

async function resolveCatalogCorePriceForUpdate({
  activeBillingProvider,
  billingProviderAdapter,
  corePrice
} = {}) {
  const normalizedProvider = normalizeText(activeBillingProvider).toLowerCase();
  if (normalizedProvider === "stripe") {
    const stripeSnapshot = await resolveStripeCatalogPriceSnapshot({
      billingProviderAdapter,
      providerPriceId: corePrice?.providerPriceId,
      fallbackProviderProductId: corePrice?.providerProductId,
      fieldPath: "corePrice.providerPriceId"
    });
    return {
      ...corePrice,
      ...stripeSnapshot
    };
  }

  return corePrice;
}

export {
  resolveStripeCatalogPriceSnapshot,
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate
};
