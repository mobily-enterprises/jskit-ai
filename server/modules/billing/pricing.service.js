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

function normalizeProviderPriceId(value) {
  return String(value || "").trim();
}

function normalizeSelectedComponents(selectedComponents) {
  const source = Array.isArray(selectedComponents) ? selectedComponents : [];
  const normalized = [];
  const seenProviderPriceIds = new Set();

  for (const entry of source) {
    const providerPriceId = normalizeProviderPriceId(entry?.providerPriceId || entry?.priceId);
    const quantityRaw = entry?.quantity == null ? 1 : Number(entry.quantity);
    if (!providerPriceId || !Number.isInteger(quantityRaw) || quantityRaw < 1 || quantityRaw > 10000) {
      throw buildConfigurationInvalidError();
    }

    const dedupeKey = providerPriceId.toLowerCase();
    if (seenProviderPriceIds.has(dedupeKey)) {
      throw buildConfigurationInvalidError();
    }
    seenProviderPriceIds.add(dedupeKey);

    normalized.push({
      providerPriceId,
      quantity: quantityRaw
    });
  }

  normalized.sort((left, right) => left.providerPriceId.localeCompare(right.providerPriceId));
  return normalized;
}

function isOptionalLicensedComponentPrice(price, { basePrice, deploymentCurrency }) {
  if (!price || !price.isActive) {
    return false;
  }
  if (Number(price.id) === Number(basePrice?.id)) {
    return false;
  }
  if (normalizeCurrency(price.currency) !== deploymentCurrency) {
    return false;
  }
  if (String(price.usageType || "").trim().toLowerCase() !== "licensed") {
    return false;
  }

  const billingComponent = String(price.billingComponent || "")
    .trim()
    .toLowerCase();
  if (billingComponent === "base" || !billingComponent) {
    return false;
  }

  if (
    String(price.interval || "").trim().toLowerCase() !== String(basePrice?.interval || "").trim().toLowerCase() ||
    Number(price.intervalCount || 0) !== Number(basePrice?.intervalCount || 0)
  ) {
    throw buildConfigurationInvalidError();
  }

  return true;
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

  async function resolveSubscriptionCheckoutPrices({ plan, provider, selectedComponents = [] }) {
    const planId = Number(plan?.id || 0);
    if (!Number.isInteger(planId) || planId < 1) {
      throw buildConfigurationInvalidError();
    }

    const normalizedSelectedComponents = normalizeSelectedComponents(selectedComponents);
    const basePrice = await resolvePhase1SellablePrice({
      planId,
      provider
    });

    const pricingModel = normalizePricingModel(plan?.pricingModel);
    const includeMetered = pricingModel === "usage" || pricingModel === "hybrid";
    const includeOptionalLicensed = normalizedSelectedComponents.length > 0;
    if (!includeMetered && !includeOptionalLicensed) {
      return {
        basePrice,
        selectedLicensedComponentPrices: [],
        meteredComponentPrices: [],
        lineItemPrices: [basePrice]
      };
    }

    const planPrices = await billingRepository.listPlanPricesForPlan(planId, provider);
    const selectedLicensedComponentPrices = [];
    if (includeOptionalLicensed) {
      for (const selectedComponent of normalizedSelectedComponents) {
        const requestedProviderPriceId = String(selectedComponent.providerPriceId || "")
          .trim()
          .toLowerCase();
        const matches = planPrices.filter((price) => {
          if (!isOptionalLicensedComponentPrice(price, { basePrice, deploymentCurrency })) {
            return false;
          }
          return String(price.providerPriceId || "").trim().toLowerCase() === requestedProviderPriceId;
        });

        if (matches.length !== 1) {
          throw buildConfigurationInvalidError();
        }

        const [componentPrice] = matches;
        selectedLicensedComponentPrices.push({
          ...componentPrice,
          quantity: selectedComponent.quantity
        });
      }
    }

    const meteredComponentPrices = [];
    if (includeMetered) {
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
    }

    meteredComponentPrices.sort((left, right) => Number(left.id || 0) - Number(right.id || 0));

    return {
      basePrice,
      selectedLicensedComponentPrices,
      meteredComponentPrices,
      lineItemPrices: [basePrice, ...selectedLicensedComponentPrices, ...meteredComponentPrices]
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
  normalizePricingModel,
  normalizeProviderPriceId,
  normalizeSelectedComponents,
  isOptionalLicensedComponentPrice
};

export { createService, __testables };
