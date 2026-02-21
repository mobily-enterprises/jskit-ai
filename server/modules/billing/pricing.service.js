import { AppError } from "../../lib/errors.js";
import { BILLING_FAILURE_CODES } from "./constants.js";

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizePricingModel(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function buildConfigurationInvalidError() {
  return new AppError(409, "Billing pricing configuration is invalid.", {
    code: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
    details: {
      code: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID
    }
  });
}

function createService({ billingRepository, billingCurrency }) {
  if (!billingRepository || typeof billingRepository.findSellablePlanPricesForPlan !== "function") {
    throw new Error("billingRepository.findSellablePlanPricesForPlan is required.");
  }
  if (typeof billingRepository.listPlanPricesForPlan !== "function") {
    throw new Error("billingRepository.listPlanPricesForPlan is required.");
  }

  const deploymentCurrency = normalizeCurrency(billingCurrency);
  if (!deploymentCurrency) {
    throw new Error("billingCurrency is required.");
  }

  async function resolvePhase1SellablePrice({ planId, provider }) {
    const prices = await billingRepository.findSellablePlanPricesForPlan({
      planId,
      provider,
      currency: deploymentCurrency
    });

    if (!Array.isArray(prices) || prices.length !== 1) {
      throw buildConfigurationInvalidError();
    }

    const [price] = prices;
    if (normalizeCurrency(price.currency) !== deploymentCurrency) {
      throw buildConfigurationInvalidError();
    }

    return price;
  }

  async function resolveSubscriptionCheckoutPrices({ plan, provider }) {
    const planId = Number(plan?.id || 0);
    if (!Number.isInteger(planId) || planId < 1) {
      throw buildConfigurationInvalidError();
    }

    const basePrice = await resolvePhase1SellablePrice({
      planId,
      provider
    });

    const pricingModel = normalizePricingModel(plan?.pricingModel);
    if (pricingModel !== "usage" && pricingModel !== "hybrid") {
      return {
        basePrice,
        meteredComponentPrices: [],
        lineItemPrices: [basePrice]
      };
    }

    const planPrices = await billingRepository.listPlanPricesForPlan(planId, provider);
    const meteredComponentPrices = [];
    for (const price of planPrices) {
      if (!price || !price.isActive) {
        continue;
      }
      if (Number(price.id) === Number(basePrice.id)) {
        continue;
      }
      if (normalizeCurrency(price.currency) !== deploymentCurrency) {
        continue;
      }
      if (String(price.usageType || "").trim().toLowerCase() !== "metered") {
        continue;
      }
      if (
        String(price.interval || "").trim().toLowerCase() !== String(basePrice.interval || "").trim().toLowerCase() ||
        Number(price.intervalCount || 0) !== Number(basePrice.intervalCount || 0)
      ) {
        throw buildConfigurationInvalidError();
      }

      meteredComponentPrices.push(price);
    }

    meteredComponentPrices.sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

    return {
      basePrice,
      meteredComponentPrices,
      lineItemPrices: [basePrice, ...meteredComponentPrices]
    };
  }

  return {
    resolvePhase1SellablePrice,
    resolveSubscriptionCheckoutPrices,
    deploymentCurrency
  };
}

const __testables = {
  normalizeCurrency,
  normalizePricingModel
};

export { createService, __testables };
