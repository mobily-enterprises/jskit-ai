import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { assertEntitlementValueOrThrow } from "../../../lib/billing/entitlementSchemaRegistry.js";

const BILLING_PLAN_PRICING_MODELS = new Set(["flat", "per_seat", "usage", "hybrid"]);
const BILLING_PRICE_INTERVALS = new Set(["day", "week", "month", "year"]);
const DEFAULT_BILLING_PROVIDER = "stripe";

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function parseOptionalPositiveInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  return parsePositiveInteger(value);
}

function toFieldValidationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function resolveBillingProvider(value) {
  return normalizeOptionalString(value).toLowerCase() || DEFAULT_BILLING_PROVIDER;
}

function normalizeBillingCatalogPlanCreatePayload(payload = {}, { activeBillingProvider } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const resolvedProvider = resolveBillingProvider(activeBillingProvider);

  const planCode = normalizeOptionalString(body.code).toLowerCase();
  if (!planCode) {
    fieldErrors.code = "code is required.";
  } else if (planCode.length > 120) {
    fieldErrors.code = "code must be at most 120 characters.";
  }

  const planFamilyCode = (normalizeOptionalString(body.planFamilyCode).toLowerCase() || planCode).trim();
  if (!planFamilyCode) {
    fieldErrors.planFamilyCode = "planFamilyCode is required.";
  } else if (planFamilyCode.length > 120) {
    fieldErrors.planFamilyCode = "planFamilyCode must be at most 120 characters.";
  }

  let version = 1;
  if (Object.hasOwn(body, "version")) {
    const parsedVersion = parseOptionalPositiveInteger(body.version);
    if (!parsedVersion) {
      fieldErrors.version = "version must be a positive integer.";
    } else {
      version = parsedVersion;
    }
  }

  const name = normalizeOptionalString(body.name);
  if (!name) {
    fieldErrors.name = "name is required.";
  } else if (name.length > 160) {
    fieldErrors.name = "name must be at most 160 characters.";
  }

  const description = normalizeOptionalString(body.description);
  const pricingModel = normalizeOptionalString(body.pricingModel).toLowerCase() || "flat";
  if (!BILLING_PLAN_PRICING_MODELS.has(pricingModel)) {
    fieldErrors.pricingModel = `pricingModel must be one of: ${Array.from(BILLING_PLAN_PRICING_MODELS).join(", ")}.`;
  }

  const basePrice = body.basePrice && typeof body.basePrice === "object" ? body.basePrice : null;
  if (!basePrice) {
    fieldErrors.basePrice = "basePrice is required.";
  }

  const providerPriceId = normalizeOptionalString(basePrice?.providerPriceId);
  if (!providerPriceId) {
    fieldErrors["basePrice.providerPriceId"] = "basePrice.providerPriceId is required.";
  } else if (providerPriceId.length > 191) {
    fieldErrors["basePrice.providerPriceId"] = "basePrice.providerPriceId must be at most 191 characters.";
  } else if (resolvedProvider === "stripe" && !providerPriceId.toLowerCase().startsWith("price_")) {
    fieldErrors["basePrice.providerPriceId"] = "basePrice.providerPriceId must be a Stripe Price ID (price_...).";
  }

  const providerProductId = normalizeOptionalString(basePrice?.providerProductId);
  if (providerProductId.length > 191) {
    fieldErrors["basePrice.providerProductId"] = "basePrice.providerProductId must be at most 191 characters.";
  }

  const requiresClientPriceDetails = resolvedProvider !== "stripe";
  const currency = normalizeOptionalString(basePrice?.currency).toUpperCase();
  if (requiresClientPriceDetails && (!currency || currency.length !== 3)) {
    fieldErrors["basePrice.currency"] = "basePrice.currency must be a 3-letter currency code.";
  }

  const parsedUnitAmountMinor = parseOptionalPositiveInteger(basePrice?.unitAmountMinor);
  const zeroAmountAllowed = Number(basePrice?.unitAmountMinor) === 0;
  const unitAmountMinor = zeroAmountAllowed ? 0 : parsedUnitAmountMinor;
  if (requiresClientPriceDetails && unitAmountMinor == null) {
    fieldErrors["basePrice.unitAmountMinor"] = "basePrice.unitAmountMinor must be zero or a positive integer.";
  }

  const intervalInput = normalizeOptionalString(basePrice?.interval).toLowerCase();
  const interval = intervalInput || (requiresClientPriceDetails ? "month" : null);
  if (requiresClientPriceDetails && !BILLING_PRICE_INTERVALS.has(interval)) {
    fieldErrors["basePrice.interval"] = `basePrice.interval must be one of: ${Array.from(BILLING_PRICE_INTERVALS).join(", ")}.`;
  }

  const parsedIntervalCount = parseOptionalPositiveInteger(basePrice?.intervalCount);
  let intervalCount = 1;
  if (requiresClientPriceDetails) {
    if (Object.hasOwn(basePrice || {}, "intervalCount")) {
      if (!parsedIntervalCount) {
        fieldErrors["basePrice.intervalCount"] = "basePrice.intervalCount must be a positive integer.";
      } else {
        intervalCount = parsedIntervalCount;
      }
    }
  } else if (parsedIntervalCount) {
    intervalCount = parsedIntervalCount;
  }

  const metadataJson = Object.hasOwn(body, "metadataJson") ? body.metadataJson : null;
  if (metadataJson != null && (typeof metadataJson !== "object" || Array.isArray(metadataJson))) {
    fieldErrors.metadataJson = "metadataJson must be an object when provided.";
  }

  const rawEntitlements = Array.isArray(body.entitlements) ? body.entitlements : [];
  const normalizedEntitlements = [];
  for (let index = 0; index < rawEntitlements.length; index += 1) {
    const entitlement = rawEntitlements[index];
    if (!entitlement || typeof entitlement !== "object") {
      fieldErrors[`entitlements[${index}]`] = "entitlements entries must be objects.";
      continue;
    }

    const entitlementCode = normalizeOptionalString(entitlement.code);
    const schemaVersion = normalizeOptionalString(entitlement.schemaVersion);
    const valueJson = entitlement.valueJson;

    if (!entitlementCode) {
      fieldErrors[`entitlements[${index}].code`] = "entitlements code is required.";
    }
    if (!schemaVersion) {
      fieldErrors[`entitlements[${index}].schemaVersion`] = "entitlements schemaVersion is required.";
    }
    if (!valueJson || typeof valueJson !== "object" || Array.isArray(valueJson)) {
      fieldErrors[`entitlements[${index}].valueJson`] = "entitlements valueJson must be an object.";
    } else if (schemaVersion) {
      try {
        assertEntitlementValueOrThrow({
          schemaVersion,
          value: valueJson,
          errorStatus: 400
        });
      } catch {
        fieldErrors[`entitlements[${index}].valueJson`] = "entitlements valueJson does not match schemaVersion.";
      }
    }

    if (entitlementCode && schemaVersion && valueJson && typeof valueJson === "object" && !Array.isArray(valueJson)) {
      normalizedEntitlements.push({
        code: entitlementCode,
        schemaVersion,
        valueJson
      });
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    plan: {
      code: planCode,
      planFamilyCode,
      version,
      name,
      description: description || null,
      appliesTo: "workspace",
      pricingModel,
      isActive: body.isActive !== false,
      metadataJson
    },
    basePrice: {
      provider: resolvedProvider,
      billingComponent: "base",
      usageType: "licensed",
      interval,
      intervalCount,
      currency: currency || null,
      unitAmountMinor,
      providerProductId: providerProductId || null,
      providerPriceId,
      isActive: true,
      metadataJson: null
    },
    entitlements: normalizedEntitlements
  };
}

function normalizeBillingCatalogPlanPricePatchPayload(payload = {}, { activeBillingProvider } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const resolvedProvider = resolveBillingProvider(activeBillingProvider);

  const providerPriceId = normalizeOptionalString(body.providerPriceId);
  if (!providerPriceId) {
    fieldErrors.providerPriceId = "providerPriceId is required.";
  } else if (providerPriceId.length > 191) {
    fieldErrors.providerPriceId = "providerPriceId must be at most 191 characters.";
  } else if (resolvedProvider === "stripe" && !providerPriceId.toLowerCase().startsWith("price_")) {
    fieldErrors.providerPriceId = "providerPriceId must be a Stripe Price ID (price_...).";
  }

  const providerProductId = normalizeOptionalString(body.providerProductId);
  if (providerProductId.length > 191) {
    fieldErrors.providerProductId = "providerProductId must be at most 191 characters.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    providerPriceId,
    providerProductId: providerProductId || null
  };
}

function mapBillingPlanDuplicateError(error) {
  if (!isMysqlDuplicateEntryError(error)) {
    return null;
  }

  const normalizedMessage = String(error?.message || "").toLowerCase();
  if (normalizedMessage.includes("uq_billing_plans_code")) {
    return new AppError(409, "Billing plan code already exists.");
  }
  if (normalizedMessage.includes("uq_billing_plans_family_version")) {
    return new AppError(409, "Billing plan family/version already exists.");
  }
  if (normalizedMessage.includes("uq_billing_plan_prices_provider_price")) {
    return new AppError(409, "Provider price id already exists.");
  }

  return new AppError(409, "Billing catalog conflict.");
}

function ensureBillingCatalogRepository(billingRepository) {
  if (!billingRepository) {
    throw new AppError(501, "Console billing catalog is not available.");
  }

  const requiredMethods = [
    "transaction",
    "listPlans",
    "listPlanPricesForPlan",
    "listPlanEntitlementsForPlan",
    "createPlan",
    "createPlanPrice",
    "upsertPlanEntitlement"
  ];
  for (const method of requiredMethods) {
    if (typeof billingRepository[method] !== "function") {
      throw new AppError(501, "Console billing catalog is not available.");
    }
  }
}

async function buildConsoleBillingPlanCatalog({ billingRepository, activeBillingProvider }) {
  const plans = await billingRepository.listPlans();
  const entries = [];
  for (const plan of plans) {
    const prices = await billingRepository.listPlanPricesForPlan(plan.id, activeBillingProvider);
    const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id);
    entries.push({
      ...plan,
      prices,
      entitlements
    });
  }

  return {
    provider: activeBillingProvider,
    plans: entries
  };
}

export {
  DEFAULT_BILLING_PROVIDER,
  resolveBillingProvider,
  normalizeBillingCatalogPlanCreatePayload,
  normalizeBillingCatalogPlanPricePatchPayload,
  mapBillingPlanDuplicateError,
  ensureBillingCatalogRepository,
  buildConsoleBillingPlanCatalog
};
