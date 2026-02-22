import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { assertEntitlementValueOrThrow } from "../../../lib/billing/entitlementSchemaRegistry.js";

const SUPPORTED_BILLING_PRICE_INTERVALS = new Set(["day", "week", "month", "year"]);
const CORE_PLAN_BILLING_PRICE_INTERVALS = new Set(["month"]);
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

function normalizeCorePricePayload(
  rawCorePrice,
  { resolvedProvider, fieldPrefix = "corePrice", requirePriceId = true, allowNull = false } = {}
) {
  const fieldErrors = {};
  const corePrice = rawCorePrice && typeof rawCorePrice === "object" ? rawCorePrice : null;
  if (!corePrice) {
    if (allowNull && rawCorePrice == null) {
      return {
        fieldErrors,
        normalizedCorePrice: null
      };
    }
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
  if (!CORE_PLAN_BILLING_PRICE_INTERVALS.has(interval)) {
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

function normalizeProductPricePayload(rawPrice, { resolvedProvider, fieldPrefix = "price", requirePriceId = true } = {}) {
  const fieldErrors = {};
  const price = rawPrice && typeof rawPrice === "object" ? rawPrice : null;
  if (!price) {
    fieldErrors[fieldPrefix] = `${fieldPrefix} is required.`;
    return {
      fieldErrors,
      normalizedPrice: null
    };
  }

  const providerPriceId = normalizeOptionalString(price.providerPriceId);
  if (requirePriceId && !providerPriceId) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId is required.`;
  } else if (providerPriceId.length > 191) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId must be at most 191 characters.`;
  } else if (resolvedProvider === "stripe" && !providerPriceId.toLowerCase().startsWith("price_")) {
    fieldErrors[`${fieldPrefix}.providerPriceId`] = `${fieldPrefix}.providerPriceId must be a Stripe Price ID (price_...).`;
  }

  const providerProductId = normalizeOptionalString(price.providerProductId);
  if (providerProductId.length > 191) {
    fieldErrors[`${fieldPrefix}.providerProductId`] = `${fieldPrefix}.providerProductId must be at most 191 characters.`;
  }

  const requiresClientPriceDetails = resolvedProvider !== "stripe";
  const currency = normalizeOptionalString(price.currency).toUpperCase();
  if (requiresClientPriceDetails && (!currency || currency.length !== 3)) {
    fieldErrors[`${fieldPrefix}.currency`] = `${fieldPrefix}.currency must be a 3-letter currency code.`;
  }

  const unitAmountMinor = parseOptionalNonNegativeInteger(price.unitAmountMinor);
  if (requiresClientPriceDetails && unitAmountMinor == null) {
    fieldErrors[`${fieldPrefix}.unitAmountMinor`] = `${fieldPrefix}.unitAmountMinor must be zero or a positive integer.`;
  }

  const rawInterval = normalizeOptionalString(price.interval).toLowerCase();
  if (rawInterval && !SUPPORTED_BILLING_PRICE_INTERVALS.has(rawInterval)) {
    fieldErrors[`${fieldPrefix}.interval`] =
      `${fieldPrefix}.interval must be one of day, week, month, or year when provided.`;
  }

  let intervalCount = null;
  if (Object.hasOwn(price, "intervalCount") && price.intervalCount !== "" && price.intervalCount != null) {
    intervalCount = parseOptionalPositiveInteger(price.intervalCount);
    if (intervalCount == null) {
      fieldErrors[`${fieldPrefix}.intervalCount`] = `${fieldPrefix}.intervalCount must be a positive integer when provided.`;
    }
  } else if (rawInterval) {
    intervalCount = 1;
  }

  if (!rawInterval && intervalCount != null) {
    fieldErrors[`${fieldPrefix}.intervalCount`] = `${fieldPrefix}.intervalCount requires ${fieldPrefix}.interval.`;
  }

  return {
    fieldErrors,
    normalizedPrice: {
      provider: resolvedProvider,
      providerPriceId,
      providerProductId: providerProductId || null,
      currency: currency || null,
      unitAmountMinor,
      interval: rawInterval || null,
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
    fieldPrefix: "corePrice",
    allowNull: true
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
  const patch = {};

  if (Object.hasOwn(body, "name")) {
    const name = normalizeOptionalString(body.name);
    if (!name) {
      fieldErrors.name = "name is required.";
    } else if (name.length > 160) {
      fieldErrors.name = "name must be at most 160 characters.";
    } else {
      patch.name = name;
    }
  }

  if (Object.hasOwn(body, "description")) {
    if (body.description == null) {
      patch.description = null;
    } else if (typeof body.description !== "string") {
      fieldErrors.description = "description must be a string when provided.";
    } else if (body.description.length > 10000) {
      fieldErrors.description = "description must be at most 10000 characters.";
    } else {
      const normalizedDescription = normalizeOptionalString(body.description);
      patch.description = normalizedDescription || null;
    }
  }

  if (Object.hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") {
      fieldErrors.isActive = "isActive must be a boolean.";
    } else {
      patch.isActive = body.isActive;
    }
  }

  if (Object.hasOwn(body, "corePrice")) {
    const { fieldErrors: corePriceFieldErrors, normalizedCorePrice } = normalizeCorePricePayload(body.corePrice, {
      resolvedProvider,
      fieldPrefix: "corePrice",
      allowNull: true
    });
    Object.assign(fieldErrors, corePriceFieldErrors);
    patch.corePrice = normalizedCorePrice;
  }

  if (Object.keys(patch).length < 1) {
    fieldErrors.request = "At least one of name, description, isActive, or corePrice must be provided.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return patch;
}

function normalizeBillingCatalogProductCreatePayload(payload = {}, { activeBillingProvider } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const resolvedProvider = resolveBillingProvider(activeBillingProvider);

  const code = normalizeOptionalString(body.code).toLowerCase();
  if (!code) {
    fieldErrors.code = "code is required.";
  } else if (code.length > 120) {
    fieldErrors.code = "code must be at most 120 characters.";
  }

  const name = normalizeOptionalString(body.name);
  if (!name) {
    fieldErrors.name = "name is required.";
  } else if (name.length > 160) {
    fieldErrors.name = "name must be at most 160 characters.";
  }

  const description = normalizeOptionalString(body.description);
  const productKind = normalizeOptionalString(body.productKind).toLowerCase() || "one_off";
  if (productKind.length > 64) {
    fieldErrors.productKind = "productKind must be at most 64 characters.";
  }

  const { fieldErrors: priceFieldErrors, normalizedPrice } = normalizeProductPricePayload(body.price, {
    resolvedProvider,
    fieldPrefix: "price"
  });
  Object.assign(fieldErrors, priceFieldErrors);

  const metadataJson = Object.hasOwn(body, "metadataJson") ? body.metadataJson : null;
  if (metadataJson != null && (typeof metadataJson !== "object" || Array.isArray(metadataJson))) {
    fieldErrors.metadataJson = "metadataJson must be an object when provided.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    product: {
      code,
      name,
      description: description || null,
      productKind,
      isActive: body.isActive !== false,
      metadataJson,
      price: normalizedPrice
    }
  };
}

function normalizeBillingCatalogProductUpdatePayload(payload = {}, { activeBillingProvider } = {}) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const resolvedProvider = resolveBillingProvider(activeBillingProvider);
  const patch = {};

  if (Object.hasOwn(body, "name")) {
    const name = normalizeOptionalString(body.name);
    if (!name) {
      fieldErrors.name = "name is required.";
    } else if (name.length > 160) {
      fieldErrors.name = "name must be at most 160 characters.";
    } else {
      patch.name = name;
    }
  }

  if (Object.hasOwn(body, "description")) {
    if (body.description == null) {
      patch.description = null;
    } else if (typeof body.description !== "string") {
      fieldErrors.description = "description must be a string when provided.";
    } else if (body.description.length > 10000) {
      fieldErrors.description = "description must be at most 10000 characters.";
    } else {
      patch.description = normalizeOptionalString(body.description) || null;
    }
  }

  if (Object.hasOwn(body, "productKind")) {
    const productKind = normalizeOptionalString(body.productKind).toLowerCase();
    if (!productKind) {
      fieldErrors.productKind = "productKind is required.";
    } else if (productKind.length > 64) {
      fieldErrors.productKind = "productKind must be at most 64 characters.";
    } else {
      patch.productKind = productKind;
    }
  }

  if (Object.hasOwn(body, "isActive")) {
    if (typeof body.isActive !== "boolean") {
      fieldErrors.isActive = "isActive must be a boolean.";
    } else {
      patch.isActive = body.isActive;
    }
  }

  if (Object.hasOwn(body, "price")) {
    const { fieldErrors: priceFieldErrors, normalizedPrice } = normalizeProductPricePayload(body.price, {
      resolvedProvider,
      fieldPrefix: "price"
    });
    Object.assign(fieldErrors, priceFieldErrors);
    if (normalizedPrice) {
      patch.price = normalizedPrice;
    }
  }

  if (Object.keys(patch).length < 1) {
    fieldErrors.request = "At least one of name, description, productKind, isActive, or price must be provided.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return patch;
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

  return new AppError(409, "Billing catalog conflict.");
}

function mapBillingProductDuplicateError(error) {
  if (!isMysqlDuplicateEntryError(error)) {
    return null;
  }

  const normalizedMessage = String(error?.message || "").toLowerCase();
  if (normalizedMessage.includes("uq_billing_products_code")) {
    return new AppError(409, "Billing product code already exists.");
  }
  if (normalizedMessage.includes("uq_billing_products_provider_price")) {
    return new AppError(409, "Provider price id is already mapped to another product.");
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

function ensureBillingProductCatalogRepository(billingRepository) {
  if (!billingRepository) {
    throw new AppError(501, "Console billing product catalog is not available.");
  }

  const requiredMethods = ["transaction", "listProducts", "findProductById", "createProduct", "updateProductById"];
  for (const method of requiredMethods) {
    if (typeof billingRepository[method] !== "function") {
      throw new AppError(501, "Console billing product catalog is not available.");
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

async function buildConsoleBillingProductCatalog({ billingRepository, activeBillingProvider }) {
  const products = await billingRepository.listProducts();
  return {
    provider: activeBillingProvider,
    products
  };
}

export {
  DEFAULT_BILLING_PROVIDER,
  resolveBillingProvider,
  normalizeBillingCatalogPlanCreatePayload,
  normalizeBillingCatalogPlanUpdatePayload,
  normalizeBillingCatalogProductCreatePayload,
  normalizeBillingCatalogProductUpdatePayload,
  mapBillingPlanDuplicateError,
  mapBillingProductDuplicateError,
  ensureBillingCatalogRepository,
  ensureBillingProductCatalogRepository,
  buildConsoleBillingPlanCatalog,
  buildConsoleBillingProductCatalog
};
