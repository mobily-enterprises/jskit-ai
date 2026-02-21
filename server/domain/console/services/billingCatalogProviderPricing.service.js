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

function normalizeUsageType(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "metered" || normalized === "licensed") {
    return normalized;
  }
  return "licensed";
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
  fieldPath = "basePrice.providerPriceId"
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

  const providerProductId = normalizeText(price.productId) || normalizeText(fallbackProviderProductId) || null;

  return {
    providerPriceId: normalizeText(price.id),
    providerProductId,
    currency,
    unitAmountMinor,
    interval,
    intervalCount,
    usageType: normalizeUsageType(price.usageType)
  };
}

async function resolveCatalogBasePriceForCreate({
  activeBillingProvider,
  billingProviderAdapter,
  basePrice
} = {}) {
  const normalizedProvider = normalizeText(activeBillingProvider).toLowerCase();
  if (normalizedProvider === "stripe") {
    const stripeSnapshot = await resolveStripeCatalogPriceSnapshot({
      billingProviderAdapter,
      providerPriceId: basePrice?.providerPriceId,
      fallbackProviderProductId: basePrice?.providerProductId,
      fieldPath: "basePrice.providerPriceId"
    });
    return {
      ...basePrice,
      ...stripeSnapshot
    };
  }

  return basePrice;
}

async function resolveCatalogPricePatchForUpdate({
  activeBillingProvider,
  billingProviderAdapter,
  patch
} = {}) {
  const normalizedProvider = normalizeText(activeBillingProvider).toLowerCase();
  if (normalizedProvider === "stripe") {
    const stripeSnapshot = await resolveStripeCatalogPriceSnapshot({
      billingProviderAdapter,
      providerPriceId: patch?.providerPriceId,
      fallbackProviderProductId: patch?.providerProductId,
      fieldPath: "providerPriceId"
    });
    return {
      ...patch,
      ...stripeSnapshot
    };
  }

  return patch;
}

export {
  resolveStripeCatalogPriceSnapshot,
  resolveCatalogBasePriceForCreate,
  resolveCatalogPricePatchForUpdate
};
