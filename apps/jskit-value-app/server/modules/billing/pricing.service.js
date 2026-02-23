import { AppError } from "../../lib/errors.js";
import { BILLING_DEFAULT_PROVIDER, BILLING_FAILURE_CODES } from "./constants.js";

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeProvider(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeInterval(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toPositiveInteger(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildConfigurationInvalidError() {
  return new AppError(409, "Billing pricing configuration is invalid.", {
    code: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
    details: {
      code: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
    }
  });
}

function toNormalizedCorePrice(plan, { provider, deploymentCurrency }) {
  const corePrice = plan?.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
  if (!corePrice) {
    throw buildConfigurationInvalidError();
  }

  const expectedProvider = normalizeProvider(provider) || BILLING_DEFAULT_PROVIDER;
  const mappedProvider = normalizeProvider(corePrice.provider) || BILLING_DEFAULT_PROVIDER;
  if (mappedProvider !== expectedProvider) {
    throw buildConfigurationInvalidError();
  }

  const providerPriceId = String(corePrice.providerPriceId || "").trim();
  if (!providerPriceId) {
    throw buildConfigurationInvalidError();
  }

  const currency = normalizeCurrency(corePrice.currency);
  if (currency !== deploymentCurrency) {
    throw buildConfigurationInvalidError();
  }

  const interval = normalizeInterval(corePrice.interval);
  const intervalCount = toPositiveInteger(corePrice.intervalCount, 1);
  if (interval !== "month" || intervalCount !== 1) {
    throw buildConfigurationInvalidError();
  }

  const unitAmountMinor = Number(corePrice.unitAmountMinor);
  if (!Number.isInteger(unitAmountMinor) || unitAmountMinor < 0) {
    throw buildConfigurationInvalidError();
  }

  return {
    provider: mappedProvider,
    providerPriceId,
    providerProductId: normalizeOptionalString(corePrice.providerProductId),
    interval,
    intervalCount,
    currency,
    unitAmountMinor
  };
}

function createService({ billingRepository, billingCurrency }) {
  if (!billingRepository || typeof billingRepository.findPlanById !== "function") {
    throw new Error("billingRepository.findPlanById is required.");
  }

  const deploymentCurrency = normalizeCurrency(billingCurrency);
  if (!deploymentCurrency) {
    throw new Error("billingCurrency is required.");
  }

  async function resolvePlanCheckoutPrice({ plan, provider }) {
    const planId = Number(plan?.id || 0);
    if (!Number.isInteger(planId) || planId < 1) {
      throw buildConfigurationInvalidError();
    }

    return toNormalizedCorePrice(plan, {
      provider,
      deploymentCurrency
    });
  }

  async function resolvePhase1SellablePrice({ planId, provider }) {
    const normalizedPlanId = Number(planId);
    if (!Number.isInteger(normalizedPlanId) || normalizedPlanId < 1) {
      throw buildConfigurationInvalidError();
    }

    const plan = await billingRepository.findPlanById(normalizedPlanId);
    if (!plan) {
      throw buildConfigurationInvalidError();
    }

    return resolvePlanCheckoutPrice({ plan, provider });
  }

  async function resolveSubscriptionCheckoutPrices({ plan, provider }) {
    const basePrice = await resolvePlanCheckoutPrice({ plan, provider });
    return {
      basePrice,
      lineItemPrices: [basePrice]
    };
  }

  return {
    resolvePlanCheckoutPrice,
    resolvePhase1SellablePrice,
    resolveSubscriptionCheckoutPrices,
    deploymentCurrency
  };
}

const __testables = {
  normalizeCurrency,
  normalizeProvider,
  normalizeInterval,
  toPositiveInteger,
  normalizeOptionalString,
  toNormalizedCorePrice
};

export { createService, __testables };
