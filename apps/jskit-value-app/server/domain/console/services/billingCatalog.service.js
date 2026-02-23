/* eslint-disable max-lines */
import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { assertEntitlementValueOrThrow } from "../../../lib/billing/entitlementSchemaRegistry.js";

const SUPPORTED_BILLING_PRICE_INTERVALS = new Set(["day", "week", "month", "year"]);
const CORE_PLAN_BILLING_PRICE_INTERVALS = new Set(["month"]);
const DEFAULT_BILLING_PROVIDER = "stripe";
const PLAN_TEMPLATE_GRANT_KINDS = new Set(["plan_base", "plan_bonus"]);
const PLAN_TEMPLATE_EFFECTIVE_POLICIES = new Set(["on_assignment_current", "on_period_paid"]);
const PLAN_TEMPLATE_DURATION_POLICIES = new Set(["while_current", "period_window", "fixed_duration"]);
const PRODUCT_TEMPLATE_GRANT_KINDS = new Set(["one_off_topup", "timeboxed_addon"]);

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

function normalizeMetadataObject(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

function resolvePositiveIntegerFromCandidates(...values) {
  for (const value of values) {
    const parsed = parsePositiveInteger(value);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizePlanTemplatePolicies(entry, { index, fieldErrors }) {
  const grantKind = normalizeOptionalString(entry?.grantKind || "plan_base").toLowerCase();
  if (!PLAN_TEMPLATE_GRANT_KINDS.has(grantKind)) {
    fieldErrors[`entitlements[${index}].grantKind`] = "grantKind must be one of plan_base or plan_bonus.";
  }

  const effectivePolicy = normalizeOptionalString(entry?.effectivePolicy || "on_assignment_current").toLowerCase();
  if (!PLAN_TEMPLATE_EFFECTIVE_POLICIES.has(effectivePolicy)) {
    fieldErrors[`entitlements[${index}].effectivePolicy`] =
      "effectivePolicy must be one of on_assignment_current or on_period_paid.";
  }

  const durationPolicy = normalizeOptionalString(entry?.durationPolicy || "while_current").toLowerCase();
  if (!PLAN_TEMPLATE_DURATION_POLICIES.has(durationPolicy)) {
    fieldErrors[`entitlements[${index}].durationPolicy`] =
      "durationPolicy must be one of while_current, period_window, or fixed_duration.";
  }

  const durationDaysValue = Object.hasOwn(entry || {}, "durationDays") ? entry.durationDays : null;
  const durationDays = durationDaysValue == null || durationDaysValue === "" ? null : parsePositiveInteger(durationDaysValue);
  if (durationPolicy === "fixed_duration" && !durationDays) {
    fieldErrors[`entitlements[${index}].durationDays`] = "durationDays is required when durationPolicy=fixed_duration.";
  }
  if (durationPolicy !== "fixed_duration" && durationDays != null) {
    fieldErrors[`entitlements[${index}].durationDays`] = "durationDays is only allowed when durationPolicy=fixed_duration.";
  }

  return {
    grantKind,
    effectivePolicy,
    durationPolicy,
    durationDays: durationPolicy === "fixed_duration" ? durationDays : null
  };
}

function normalizePlanEdgeEntitlements(rawEntitlements, { fieldErrors, allowOmitted = false } = {}) {
  if (rawEntitlements === undefined && allowOmitted) {
    return null;
  }

  const source = Array.isArray(rawEntitlements) ? rawEntitlements : [];
  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fieldErrors[`entitlements[${index}]`] = "entitlements entries must be objects.";
      continue;
    }

    const code = normalizeOptionalString(entry.code);
    const schemaVersion = normalizeOptionalString(entry.schemaVersion);
    const valueJson = entry.valueJson;
    if (!code) {
      fieldErrors[`entitlements[${index}].code`] = "code is required.";
    }
    if (!schemaVersion) {
      fieldErrors[`entitlements[${index}].schemaVersion`] = "schemaVersion is required.";
    }
    if (!valueJson || typeof valueJson !== "object" || Array.isArray(valueJson)) {
      fieldErrors[`entitlements[${index}].valueJson`] = "valueJson must be an object.";
    } else if (schemaVersion) {
      try {
        assertEntitlementValueOrThrow({
          schemaVersion,
          value: valueJson,
          errorStatus: 400
        });
      } catch {
        fieldErrors[`entitlements[${index}].valueJson`] = "valueJson does not match schemaVersion.";
      }
    }

    const policies = normalizePlanTemplatePolicies(entry, {
      index,
      fieldErrors
    });
    const metadataJson = normalizeMetadataObject(entry.metadataJson);
    if (Object.hasOwn(entry, "metadataJson") && metadataJson == null) {
      fieldErrors[`entitlements[${index}].metadataJson`] = "metadataJson must be an object when provided.";
    }

    const amount = resolvePositiveIntegerFromCandidates(valueJson?.amount, valueJson?.limit, valueJson?.max);
    if (!amount) {
      fieldErrors[`entitlements[${index}].valueJson`] =
        "valueJson must include a positive integer amount/limit/max value.";
    }

    if (code && schemaVersion && valueJson && typeof valueJson === "object" && !Array.isArray(valueJson) && amount) {
      normalized.push({
        code,
        schemaVersion,
        valueJson,
        amount,
        grantKind: policies.grantKind,
        effectivePolicy: policies.effectivePolicy,
        durationPolicy: policies.durationPolicy,
        durationDays: policies.durationDays,
        metadataJson
      });
    }
  }

  return normalized;
}

function normalizeProductEdgeEntitlements(rawEntitlements, { fieldErrors, allowOmitted = false } = {}) {
  if (rawEntitlements === undefined && allowOmitted) {
    return null;
  }

  const source = Array.isArray(rawEntitlements) ? rawEntitlements : [];
  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      fieldErrors[`entitlements[${index}]`] = "entitlements entries must be objects.";
      continue;
    }

    const code = normalizeOptionalString(entry.code);
    if (!code) {
      fieldErrors[`entitlements[${index}].code`] = "code is required.";
    }

    const amount = parsePositiveInteger(entry.amount);
    if (!amount) {
      fieldErrors[`entitlements[${index}].amount`] = "amount must be a positive integer.";
    }

    const grantKind = normalizeOptionalString(entry.grantKind || "one_off_topup").toLowerCase();
    if (!PRODUCT_TEMPLATE_GRANT_KINDS.has(grantKind)) {
      fieldErrors[`entitlements[${index}].grantKind`] =
        "grantKind must be one of one_off_topup or timeboxed_addon.";
    }

    const durationDaysValue = Object.hasOwn(entry || {}, "durationDays") ? entry.durationDays : null;
    const durationDays = durationDaysValue == null || durationDaysValue === "" ? null : parsePositiveInteger(durationDaysValue);
    if (grantKind === "timeboxed_addon" && !durationDays) {
      fieldErrors[`entitlements[${index}].durationDays`] = "durationDays is required when grantKind=timeboxed_addon.";
    }
    if (grantKind === "one_off_topup" && durationDays != null) {
      fieldErrors[`entitlements[${index}].durationDays`] = "durationDays is not allowed for one_off_topup grants.";
    }

    const metadataJson = normalizeMetadataObject(entry.metadataJson);
    if (Object.hasOwn(entry, "metadataJson") && metadataJson == null) {
      fieldErrors[`entitlements[${index}].metadataJson`] = "metadataJson must be an object when provided.";
    }

    if (code && amount && PRODUCT_TEMPLATE_GRANT_KINDS.has(grantKind)) {
      normalized.push({
        code,
        amount,
        grantKind,
        durationDays: grantKind === "timeboxed_addon" ? durationDays : null,
        metadataJson
      });
    }
  }

  return normalized;
}

function mapPlanEntitlementsToTemplates(entitlements = [], definitionByCode = new Map()) {
  const source = Array.isArray(entitlements) ? entitlements : [];
  const templates = [];
  const fieldErrors = {};

  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    const definition = definitionByCode.get(String(entry?.code || ""));
    if (!definition) {
      fieldErrors[`entitlements[${index}].code`] = "Unknown entitlement definition code.";
      continue;
    }

    templates.push({
      entitlementDefinitionId: Number(definition.id),
      amount: Number(entry.amount),
      grantKind: entry.grantKind,
      effectivePolicy: entry.effectivePolicy,
      durationPolicy: entry.durationPolicy,
      durationDays: entry.durationDays == null ? null : Number(entry.durationDays),
      metadataJson: {
        schemaVersion: entry.schemaVersion,
        valueJson: entry.valueJson,
        metadataJson: entry.metadataJson
      }
    });
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return templates;
}

function mapProductEntitlementsToTemplates(entitlements = [], definitionByCode = new Map()) {
  const source = Array.isArray(entitlements) ? entitlements : [];
  const templates = [];
  const fieldErrors = {};

  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    const definition = definitionByCode.get(String(entry?.code || ""));
    if (!definition) {
      fieldErrors[`entitlements[${index}].code`] = "Unknown entitlement definition code.";
      continue;
    }

    templates.push({
      entitlementDefinitionId: Number(definition.id),
      amount: Number(entry.amount),
      grantKind: entry.grantKind,
      durationDays: entry.durationDays == null ? null : Number(entry.durationDays),
      metadataJson: entry.metadataJson || {}
    });
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return templates;
}

function mapPlanTemplatesToConsoleEntitlements(templates = [], definitionById = new Map()) {
  const source = Array.isArray(templates) ? templates : [];
  return source
    .map((template) => {
      const definition = definitionById.get(Number(template?.entitlementDefinitionId || 0));
      if (!definition) {
        return null;
      }

      const metadata = template?.metadataJson && typeof template.metadataJson === "object" ? template.metadataJson : {};
      const valueJson =
        metadata.valueJson && typeof metadata.valueJson === "object" && !Array.isArray(metadata.valueJson)
          ? metadata.valueJson
          : {
              limit: Number(template.amount || 0),
              interval: "month",
              enforcement: "hard"
            };

      return {
        code: String(definition.code || ""),
        schemaVersion: normalizeOptionalString(metadata.schemaVersion) || "entitlement.quota.v1",
        valueJson,
        grantKind: String(template.grantKind || "plan_base"),
        effectivePolicy: String(template.effectivePolicy || "on_assignment_current"),
        durationPolicy: String(template.durationPolicy || "while_current"),
        durationDays: template.durationDays == null ? null : Number(template.durationDays),
        metadataJson:
          metadata.metadataJson && typeof metadata.metadataJson === "object" && !Array.isArray(metadata.metadataJson)
            ? metadata.metadataJson
            : null
      };
    })
    .filter(Boolean);
}

function mapProductTemplatesToConsoleEntitlements(templates = [], definitionById = new Map()) {
  const source = Array.isArray(templates) ? templates : [];
  return source
    .map((template) => {
      const definition = definitionById.get(Number(template?.entitlementDefinitionId || 0));
      if (!definition) {
        return null;
      }

      const metadataJson =
        template?.metadataJson && typeof template.metadataJson === "object" && !Array.isArray(template.metadataJson)
          ? template.metadataJson
          : {};
      return {
        code: String(definition.code || ""),
        amount: Number(template.amount || 0),
        grantKind: String(template.grantKind || "one_off_topup"),
        durationDays: template.durationDays == null ? null : Number(template.durationDays),
        metadataJson
      };
    })
    .filter(Boolean);
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

  const normalizedEntitlements = normalizePlanEdgeEntitlements(body.entitlements, {
    fieldErrors
  });

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

  const entitlementsProvided = Object.hasOwn(body, "entitlements");
  const normalizedEntitlements = normalizePlanEdgeEntitlements(body.entitlements, {
    fieldErrors,
    allowOmitted: true
  });

  if (Object.keys(patch).length < 1 && !entitlementsProvided) {
    fieldErrors.request =
      "At least one of name, description, isActive, corePrice, or entitlements must be provided.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    patch,
    entitlementsProvided,
    entitlements: normalizedEntitlements || []
  };
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

  const normalizedEntitlements = normalizeProductEdgeEntitlements(body.entitlements, {
    fieldErrors
  });

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
    },
    entitlements: normalizedEntitlements
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

  const entitlementsProvided = Object.hasOwn(body, "entitlements");
  const normalizedEntitlements = normalizeProductEdgeEntitlements(body.entitlements, {
    fieldErrors,
    allowOmitted: true
  });

  if (Object.keys(patch).length < 1 && !entitlementsProvided) {
    fieldErrors.request =
      "At least one of name, description, productKind, isActive, price, or entitlements must be provided.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw toFieldValidationError(fieldErrors);
  }

  return {
    patch,
    entitlementsProvided,
    entitlements: normalizedEntitlements || []
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

  const requiredMethods = [
    "transaction",
    "listPlans",
    "findPlanById",
    "createPlan",
    "updatePlanById",
    "listEntitlementDefinitions",
    "listPlanEntitlementTemplates",
    "replacePlanEntitlementTemplates"
  ];
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

  const requiredMethods = [
    "transaction",
    "listProducts",
    "findProductById",
    "createProduct",
    "updateProductById",
    "listEntitlementDefinitions",
    "listProductEntitlementTemplates",
    "replaceProductEntitlementTemplates"
  ];
  for (const method of requiredMethods) {
    if (typeof billingRepository[method] !== "function") {
      throw new AppError(501, "Console billing product catalog is not available.");
    }
  }
}

async function buildConsoleBillingPlanCatalog({ billingRepository, activeBillingProvider }) {
  const plans = await billingRepository.listPlans();
  const definitions = await billingRepository.listEntitlementDefinitions({
    includeInactive: true
  });
  const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
  const entries = [];
  for (const plan of plans) {
    const templates = await billingRepository.listPlanEntitlementTemplates(plan.id);
    const entitlements = mapPlanTemplatesToConsoleEntitlements(templates, definitionById);
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
  const definitions = await billingRepository.listEntitlementDefinitions({
    includeInactive: true
  });
  const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
  const entries = [];
  for (const product of products) {
    const templates = await billingRepository.listProductEntitlementTemplates(product.id);
    entries.push({
      ...product,
      entitlements: mapProductTemplatesToConsoleEntitlements(templates, definitionById)
    });
  }

  return {
    provider: activeBillingProvider,
    products: entries
  };
}

export {
  DEFAULT_BILLING_PROVIDER,
  resolveBillingProvider,
  normalizeBillingCatalogPlanCreatePayload,
  normalizeBillingCatalogPlanUpdatePayload,
  normalizeBillingCatalogProductCreatePayload,
  normalizeBillingCatalogProductUpdatePayload,
  mapPlanEntitlementsToTemplates,
  mapProductEntitlementsToTemplates,
  mapPlanTemplatesToConsoleEntitlements,
  mapProductTemplatesToConsoleEntitlements,
  mapBillingPlanDuplicateError,
  mapBillingProductDuplicateError,
  ensureBillingCatalogRepository,
  ensureBillingProductCatalogRepository,
  buildConsoleBillingPlanCatalog,
  buildConsoleBillingProductCatalog
};
