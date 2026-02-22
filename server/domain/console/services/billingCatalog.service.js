import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { assertEntitlementValueOrThrow } from "../../../lib/billing/entitlementSchemaRegistry.js";

const BILLING_PRICE_INTERVALS = new Set(["month"]);
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

function parseOptionalNonNegativeInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
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

function normalizeCorePricePayload(rawCorePrice, { resolvedProvider, fieldPrefix = "corePrice", requirePriceId = true } = {}) {
  const fieldErrors = {};
  const corePrice = rawCorePrice && typeof rawCorePrice === "object" ? rawCorePrice : null;
  if (!corePrice) {
    fieldErrors[fieldPrefix] = `${fieldPrefix} is required.`;
    return {
      fieldErrors,
      normalizedCorePrice: null
    };
  }

  const providerPriceId = normalizeOptionalString(corePrice.providerPriceId);
  if (requirePriceId && !providerPriceId) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId is required.`;
  } else if (providerPriceId.length > 191) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId must be at most 191 characters.`;
  } else if (resolvedProvider === "stripe" && !providerPriceId.toLowerCase().startsWith("price_")) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId must be a Stripe Price ID (price_...).`;
  }

  const providerProductId = normalizeOptionalString(corePrice.providerProductId);
  if (providerProductId.length > 191) {
    fieldErrors[`${fieldPrefix}.providerProductId`] = `${fieldPrefix}.providerProductId must be at most 191 characters.`;
  }

  const requiresClientPriceDetails = resolvedProvider !== "stripe";
  const currency = normalizeOptionalString(corePrice.currency).toUpperCase();
  if (requiresClientPriceDetails && (!currency || currency.length !== 3)) {
    fieldErrors[`${fieldPrefix}.currency`] = `${fieldPrefix}.currency must be a 3-letter currency code.`;
  }

  const unitAmountMinor = parseOptionalNonNegativeInteger(corePrice.unitAmountMinor);
  if (requiresClientPriceDetails && unitAmountMinor == null) {
    fieldErrors[`${fieldPrefix}.unitAmountMinor`] = `${fieldPrefix}.unitAmountMinor must be zero or a positive integer.`;
  }

  const interval = normalizeOptionalString(corePrice.interval).toLowerCase() || "month";
  if (!BILLING_PRICE_INTERVALS.has(interval)) {
    fieldErrors[`${fieldPrefix}.interval`] = `${fieldPrefix}.interval must be month for core plans.`;
  }

  const intervalCount = parseOptionalPositiveInteger(corePrice.intervalCount) ?? 1;
  if (intervalCount !== 1) {
    fieldErrors[`${fieldPrefix}.intervalCount`] = `${fieldPrefix}.intervalCount must be 1 for core plans.`;
  }

  return {
    fieldErrors,
    normalizedCorePrice: {
      provider: resolvedProvider,
      providerPriceId,
      providerProductId: providerProductId || null,
      currency: currency || null,
      unitAmountMinor,
      interval,
      intervalCount
    }
  };
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

  const name = normalizeOptionalString(body.name);
  if (!name) {
    fieldErrors.name = "name is required.";
  } else if (name.length > 160) {
    fieldErrors.name = "name must be at most 160 characters.";
  }

  const description = normalizeOptionalString(body.description);

  const { fieldErrors: corePriceFieldErrors, normalizedCorePrice } = normalizeCorePricePayload(body.corePrice, {
    resolvedProvider,
    fieldPrefix: "corePrice"
  });
  Object.assign(fieldErrors, corePriceFieldErrors);

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
      name,
      description: description || null,
      appliesTo: "workspace",
      isActive: body.isActive !== false,
      metadataJson,
      corePrice: normalizedCorePrice
    },
    entitlements: normalizedEntitlements
  };
}

function normalizeBillingCatalogPlanUpdatePayload(payload = {}, { activeBillingProvider } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const resolvedProvider = resolveBillingProvider(activeBillingProvider);

  const { fieldErrors: corePriceFieldErrors, normalizedCorePrice } = normalizeCorePricePayload(body.corePrice, {
    resolvedProvider,
    fieldPrefix: "corePrice"
  });
  Object.assign(fieldErrors, corePriceFieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    corePrice: normalizedCorePrice
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
  if (normalizedMessage.includes("uq_billing_plans_checkout_provider_price")) {
    return new AppError(409, "Provider price id is already mapped to another plan.");
  }
  if (normalizedMessage.includes("uq_billing_plan_prices_provider_price")) {
    return new AppError(409, "Provider price id is already mapped to another plan.");
  }

  return new AppError(409, "Billing catalog conflict.");
}

function ensureBillingCatalogRepository(billingRepository) {
  if (!billingRepository) {
    throw new AppError(501, "Console billing catalog is not available.");
  }

  const requiredMethods = ["transaction", "listPlans", "findPlanById", "listPlanEntitlementsForPlan", "createPlan", "updatePlanById", "upsertPlanEntitlement"];
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
    const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id);
    entries.push({
      ...plan,
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
  normalizeBillingCatalogPlanUpdatePayload,
  mapBillingPlanDuplicateError,
  ensureBillingCatalogRepository,
  buildConsoleBillingPlanCatalog
};
