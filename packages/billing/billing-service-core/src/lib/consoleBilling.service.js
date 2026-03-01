import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizePagination } from "@jskit-ai/server-runtime-core/pagination";
import { isDuplicateEntryError } from "@jskit-ai/jskit-knex/errors";
import { CONSOLE_BILLING_PERMISSIONS } from "@jskit-ai/workspace-console-core/consoleRoles";
import {
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
} from "./billingCatalog.service.js";
import {
  resolveCatalogCorePriceForCreate,
  resolveCatalogCorePriceForUpdate,
  resolveCatalogProductPriceForCreate,
  resolveCatalogProductPriceForUpdate
} from "./billingCatalogProviderPricing.service.js";
import { createBillingSettingsService } from "./billingSettings.service.js";

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function normalizeOptionalBoolean(value, fallback) {
  if (value === true || value === false) {
    return value;
  }

  const normalized = normalizeOptionalString(value).toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

function normalizeCodeFilters(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((entry) => normalizeOptionalString(entry)).filter(Boolean)));
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((entry) => normalizeOptionalString(entry))
          .filter(Boolean)
      )
    );
  }
  return [];
}

function normalizeProviderPriceTarget(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (normalized === "plan" || normalized === "product") {
    return normalized;
  }
  return "";
}

function isRecurringProviderPrice(price) {
  const interval = normalizeOptionalString(price?.interval).toLowerCase();
  const intervalCount = parsePositiveInteger(price?.intervalCount);
  return Boolean(interval && intervalCount);
}

function filterProviderPricesByTarget(prices, target) {
  const entries = Array.isArray(prices) ? prices : [];
  if (target === "plan") {
    return entries.filter((price) => isRecurringProviderPrice(price));
  }
  if (target === "product") {
    return entries.filter((price) => !isRecurringProviderPrice(price));
  }
  return entries;
}

function mapEntitlementDefinitionToConsole(entry = {}) {
  const id = parsePositiveInteger(entry?.id);
  const code = normalizeOptionalString(entry?.code);
  if (!id || !code) {
    return null;
  }

  return {
    id,
    code,
    name: normalizeOptionalString(entry?.name),
    description: entry?.description == null ? null : String(entry.description || ""),
    entitlementType: normalizeOptionalString(entry?.entitlementType),
    unit: normalizeOptionalString(entry?.unit),
    windowInterval: entry?.windowInterval == null ? null : normalizeOptionalString(entry?.windowInterval),
    enforcementMode: normalizeOptionalString(entry?.enforcementMode),
    isActive: entry?.isActive !== false
  };
}

function createNotImplementedBillingOperationError(operation) {
  const normalizedOperation = normalizeOptionalString(operation) || "unknown_operation";
  return new AppError(501, "Console billing operation is not implemented.", {
    code: "CONSOLE_BILLING_OPERATION_NOT_IMPLEMENTED",
    details: {
      code: "CONSOLE_BILLING_OPERATION_NOT_IMPLEMENTED",
      operation: normalizedOperation
    }
  });
}

function normalizePositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 0;
  }

  return parsed;
}

function normalizeOptionalDateTime(value) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return null;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function resolveClientIdempotencyKey(payload = {}) {
  return (
    normalizeOptionalString(payload?.idempotencyKey) ||
    normalizeOptionalString(payload?.clientIdempotencyKey) ||
    normalizeOptionalString(payload?.requestIdempotencyKey)
  );
}

function mapPurchaseToConsole(entry = {}) {
  const id = normalizePositiveInteger(entry?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    billableEntityId: normalizePositiveInteger(entry?.billableEntityId) || null,
    workspaceId: normalizePositiveInteger(entry?.workspaceId) || null,
    provider: normalizeOptionalString(entry?.provider),
    purchaseKind: normalizeOptionalString(entry?.purchaseKind),
    status: normalizeOptionalString(entry?.status),
    amountMinor: Number(entry?.amountMinor || 0),
    currency: normalizeOptionalString(entry?.currency).toUpperCase(),
    quantity: normalizePositiveInteger(entry?.quantity) || 1,
    operationKey: normalizeOptionalString(entry?.operationKey) || null,
    providerPaymentId: normalizeOptionalString(entry?.providerPaymentId) || null,
    providerInvoiceId: normalizeOptionalString(entry?.providerInvoiceId) || null,
    displayName: entry?.displayName == null ? null : String(entry.displayName || ""),
    metadataJson: entry?.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : {},
    purchasedAt: entry?.purchasedAt ? String(entry.purchasedAt) : null
  };
}

function mapPurchaseAdjustmentToConsole(entry = {}) {
  const id = normalizePositiveInteger(entry?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    purchaseId: normalizePositiveInteger(entry?.purchaseId),
    actionType: normalizeOptionalString(entry?.actionType),
    status: normalizeOptionalString(entry?.status),
    amountMinor: entry?.amountMinor == null ? null : Number(entry.amountMinor),
    currency: entry?.currency == null ? null : normalizeOptionalString(entry.currency).toUpperCase(),
    reasonCode: entry?.reasonCode == null ? null : normalizeOptionalString(entry.reasonCode),
    providerReference: entry?.providerReference == null ? null : normalizeOptionalString(entry.providerReference),
    requestedByUserId: normalizePositiveInteger(entry?.requestedByUserId) || null,
    requestIdempotencyKey: entry?.requestIdempotencyKey == null ? null : normalizeOptionalString(entry.requestIdempotencyKey),
    metadataJson: entry?.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : {},
    createdAt: entry?.createdAt ? String(entry.createdAt) : null
  };
}

function createConsolePurchaseError(status, message, code, details = {}) {
  return new AppError(status, message, {
    code,
    details: {
      code,
      ...details
    }
  });
}

const PLAN_ASSIGNMENT_STATUS_SET = new Set(["current", "upcoming", "past", "canceled"]);
const PLAN_ASSIGNMENT_SOURCE_SET = new Set(["internal", "promo", "manual"]);
const TERMINAL_PROVIDER_SUBSCRIPTION_STATUS_SET = new Set([
  "canceled",
  "cancelled",
  "incomplete_expired",
  "ended",
  "expired"
]);

function normalizeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizePlanAssignmentStatus(value, fallback = "current") {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (PLAN_ASSIGNMENT_STATUS_SET.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePlanAssignmentSource(value, fallback = "manual") {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (PLAN_ASSIGNMENT_SOURCE_SET.has(normalized)) {
    return normalized;
  }
  return fallback;
}

function normalizePlanAssignmentStatusFilters(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => normalizePlanAssignmentStatus(entry, ""))
          .filter((entry) => PLAN_ASSIGNMENT_STATUS_SET.has(entry))
      )
    );
  }

  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return [];
  }

  return Array.from(
    new Set(
      normalized
        .split(",")
        .map((entry) => normalizePlanAssignmentStatus(entry, ""))
        .filter((entry) => PLAN_ASSIGNMENT_STATUS_SET.has(entry))
    )
  );
}

function resolvePlanDefaultPeriodEndAt(plan, periodStartAt) {
  const amount = Number(plan?.corePrice?.unitAmountMinor || 0);
  if (!Number.isInteger(amount) || amount <= 0) {
    return null;
  }
  return addUtcDays(periodStartAt, 30);
}

function parseUnixEpochSecondsToDate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  if (parsed > 1_000_000_000_000) {
    const dateFromMillis = new Date(parsed);
    if (!Number.isNaN(dateFromMillis.getTime())) {
      return dateFromMillis;
    }
  }

  const date = new Date(parsed * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function resolveProviderObjectId(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const normalized = normalizeOptionalString(value);
    return normalized || null;
  }
  if (typeof value === "object") {
    const normalized = normalizeOptionalString(value.id);
    return normalized || null;
  }
  return null;
}

function normalizeProviderSubscriptionStatus(value) {
  const normalized = normalizeOptionalString(value).toLowerCase();
  if (!normalized) {
    return "incomplete";
  }
  if (normalized === "cancelled") {
    return "canceled";
  }
  return normalized;
}

function mapPlanAssignmentToConsole(entry = {}) {
  const id = normalizePositiveInteger(entry?.id);
  if (!id) {
    return null;
  }

  return {
    id,
    billableEntityId: normalizePositiveInteger(entry?.billableEntityId) || null,
    workspaceId: normalizePositiveInteger(entry?.workspaceId) || null,
    workspaceSlug: normalizeOptionalString(entry?.workspaceSlug) || null,
    planId: normalizePositiveInteger(entry?.planId) || null,
    planCode: normalizeOptionalString(entry?.planCode) || null,
    planName: normalizeOptionalString(entry?.planName) || null,
    source: normalizeOptionalString(entry?.source),
    status: normalizeOptionalString(entry?.status),
    periodStartAt: entry?.periodStartAt ? String(entry.periodStartAt) : null,
    periodEndAt: entry?.periodEndAt ? String(entry.periodEndAt) : null,
    provider: normalizeOptionalString(entry?.provider) || null,
    providerSubscriptionId: normalizeOptionalString(entry?.providerSubscriptionId) || null,
    providerStatus: normalizeOptionalString(entry?.providerStatus) || null,
    currentPeriodEnd: entry?.currentPeriodEnd ? String(entry.currentPeriodEnd) : null,
    cancelAtPeriodEnd:
      entry?.cancelAtPeriodEnd === true ? true : entry?.cancelAtPeriodEnd === false ? false : null,
    metadataJson: entry?.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : {},
    createdAt: entry?.createdAt ? String(entry.createdAt) : null,
    updatedAt: entry?.updatedAt ? String(entry.updatedAt) : null
  };
}

function mapSubscriptionToConsole(entry = {}) {
  const providerSubscriptionId = normalizeOptionalString(entry?.providerSubscriptionId);
  if (!providerSubscriptionId) {
    return null;
  }

  return {
    provider: normalizeOptionalString(entry?.provider),
    providerSubscriptionId,
    providerCustomerId: normalizeOptionalString(entry?.providerCustomerId) || null,
    status: normalizeOptionalString(entry?.status),
    providerSubscriptionCreatedAt: entry?.providerSubscriptionCreatedAt
      ? String(entry.providerSubscriptionCreatedAt)
      : null,
    currentPeriodEnd: entry?.currentPeriodEnd ? String(entry.currentPeriodEnd) : null,
    trialEnd: entry?.trialEnd ? String(entry.trialEnd) : null,
    canceledAt: entry?.canceledAt ? String(entry.canceledAt) : null,
    cancelAtPeriodEnd: Boolean(entry?.cancelAtPeriodEnd),
    endedAt: entry?.endedAt ? String(entry.endedAt) : null,
    assignmentId: normalizePositiveInteger(entry?.assignmentId) || null,
    assignmentStatus: normalizeOptionalString(entry?.assignmentStatus),
    assignmentPeriodStartAt: entry?.assignmentPeriodStartAt ? String(entry.assignmentPeriodStartAt) : null,
    assignmentPeriodEndAt: entry?.assignmentPeriodEndAt ? String(entry.assignmentPeriodEndAt) : null,
    billableEntityId: normalizePositiveInteger(entry?.billableEntityId) || null,
    workspaceId: normalizePositiveInteger(entry?.workspaceId) || null,
    workspaceSlug: normalizeOptionalString(entry?.workspaceSlug) || null,
    planId: normalizePositiveInteger(entry?.planId) || null,
    planCode: normalizeOptionalString(entry?.planCode) || null,
    planName: normalizeOptionalString(entry?.planName) || null,
    metadataJson: entry?.metadataJson && typeof entry.metadataJson === "object" ? entry.metadataJson : {}
  };
}

function createConsoleSubscriptionError(status, message, code, details = {}) {
  return new AppError(status, message, {
    code,
    details: {
      code,
      ...details
    }
  });
}

function createConsoleBillingService({
  requirePermission,
  ensureConsoleSettings,
  consoleSettingsRepository,
  billingEnabled = true,
  billingRepository = null,
  billingProviderAdapter = null,
  activeBillingProvider = "stripe"
} = {}) {
  const { getBillingSettings, updateBillingSettings } = createBillingSettingsService({
    requirePermission,
    ensureConsoleSettings,
    consoleSettingsRepository
  });

  async function listBillingEvents(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.READ_ALL);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingRepository || typeof billingRepository.listBillingActivityEvents !== "function") {
      throw new AppError(501, "Console billing event explorer is not available.");
    }

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 25,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const workspaceSlug = normalizeOptionalString(query?.workspaceSlug);
    const ownerUserId = parsePositiveInteger(query?.userId);
    const billableEntityId = parsePositiveInteger(query?.billableEntityId);
    const operationKey = normalizeOptionalString(query?.operationKey);
    const providerEventId = normalizeOptionalString(query?.providerEventId);
    const source = normalizeOptionalString(query?.source).toLowerCase();

    const events = await billingRepository.listBillingActivityEvents({
      workspaceSlug: workspaceSlug || null,
      ownerUserId: ownerUserId || null,
      billableEntityId: billableEntityId || null,
      operationKey: operationKey || null,
      providerEventId: providerEventId || null,
      source: source || null,
      includeGlobal: true,
      limit: fetchLimit
    });

    const hasMore = events.length > startIndex + pagination.pageSize;
    const entries = events.slice(startIndex, startIndex + pagination.pageSize);

    return {
      entries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function listBillingPlans(user) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);
    const catalog = await buildConsoleBillingPlanCatalog({
      billingRepository,
      activeBillingProvider
    });

    const definitions = await billingRepository.listEntitlementDefinitions({
      includeInactive: true
    });

    return {
      ...catalog,
      entitlementDefinitions: (Array.isArray(definitions) ? definitions : [])
        .map((entry) => mapEntitlementDefinitionToConsole(entry))
        .filter(Boolean)
    };
  }

  async function listBillingProducts(user) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingProductCatalogRepository(billingRepository);
    return buildConsoleBillingProductCatalog({
      billingRepository,
      activeBillingProvider
    });
  }

  async function createBillingPlan(user, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);
    const normalized = normalizeBillingCatalogPlanCreatePayload(payload, {
      activeBillingProvider
    });
    const resolvedCorePrice = await resolveCatalogCorePriceForCreate({
      activeBillingProvider,
      billingProviderAdapter,
      corePrice: normalized.plan.corePrice
    });

    try {
      const createdPlan = await billingRepository.transaction(async (trx) => {
        const definitions = await billingRepository.listEntitlementDefinitions(
          {
            includeInactive: true
          },
          { trx }
        );
        const definitionByCode = new Map(definitions.map((entry) => [String(entry.code || ""), entry]));
        const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
        const templates = mapPlanEntitlementsToTemplates(normalized.entitlements, definitionByCode);

        const plan = await billingRepository.createPlan(
          {
            ...normalized.plan,
            corePrice: resolvedCorePrice
          },
          { trx }
        );

        await billingRepository.replacePlanEntitlementTemplates(plan.id, templates, { trx });
        const persistedTemplates = await billingRepository.listPlanEntitlementTemplates(plan.id, { trx });
        const entitlements = mapPlanTemplatesToConsoleEntitlements(persistedTemplates, definitionById);
        return {
          ...plan,
          entitlements
        };
      });

      return {
        provider: activeBillingProvider,
        plan: createdPlan
      };
    } catch (error) {
      const mappedError = mapBillingPlanDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
  }

  async function createBillingProduct(user, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingProductCatalogRepository(billingRepository);
    const normalized = normalizeBillingCatalogProductCreatePayload(payload, {
      activeBillingProvider
    });
    const resolvedPrice = await resolveCatalogProductPriceForCreate({
      activeBillingProvider,
      billingProviderAdapter,
      price: normalized.product.price
    });

    try {
      const createdProduct = await billingRepository.transaction(async (trx) => {
        const definitions = await billingRepository.listEntitlementDefinitions(
          {
            includeInactive: true
          },
          { trx }
        );
        const definitionByCode = new Map(definitions.map((entry) => [String(entry.code || ""), entry]));
        const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
        const templates = mapProductEntitlementsToTemplates(normalized.entitlements, definitionByCode);

        const product = await billingRepository.createProduct(
          {
            ...normalized.product,
            price: resolvedPrice
          },
          { trx }
        );
        await billingRepository.replaceProductEntitlementTemplates(product.id, templates, { trx });
        const persistedTemplates = await billingRepository.listProductEntitlementTemplates(product.id, { trx });

        return {
          ...product,
          entitlements: mapProductTemplatesToConsoleEntitlements(persistedTemplates, definitionById)
        };
      });

      return {
        provider: activeBillingProvider,
        product: createdProduct
      };
    } catch (error) {
      const mappedError = mapBillingProductDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
  }

  async function listBillingProviderPrices(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.listPrices !== "function") {
      throw new AppError(501, "Provider price listing is not available.");
    }

    const limit = Math.max(1, Math.min(100, parsePositiveInteger(query?.limit) || 100));
    const normalizedActive = String(query?.active ?? "")
      .trim()
      .toLowerCase();
    const active = normalizedActive === "false" || normalizedActive === "0" ? false : true;
    const target = normalizeProviderPriceTarget(query?.target);
    const prices = await billingProviderAdapter.listPrices({
      limit,
      active
    });

    return {
      provider: activeBillingProvider,
      prices: filterProviderPricesByTarget(prices, target)
    };
  }

  async function updateBillingPlan(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingCatalogRepository(billingRepository);

    const planId = parsePositiveInteger(params?.planId);
    if (!planId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            planId: "planId is required."
          }
        }
      });
    }

    const normalizedUpdate = normalizeBillingCatalogPlanUpdatePayload(payload, {
      activeBillingProvider
    });
    const resolvedCorePrice = Object.hasOwn(normalizedUpdate.patch, "corePrice")
      ? await resolveCatalogCorePriceForUpdate({
          activeBillingProvider,
          billingProviderAdapter,
          corePrice: normalizedUpdate.patch.corePrice
        })
      : null;

    try {
      const updatedPlan = await billingRepository.transaction(async (trx) => {
        const definitions = await billingRepository.listEntitlementDefinitions(
          {
            includeInactive: true
          },
          { trx }
        );
        const definitionByCode = new Map(definitions.map((entry) => [String(entry.code || ""), entry]));
        const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
        const plan = await billingRepository.findPlanById(planId, { trx });
        if (!plan) {
          throw new AppError(404, "Billing plan not found.");
        }

        const updatePatch = {
          ...normalizedUpdate.patch
        };
        if (Object.hasOwn(normalizedUpdate.patch, "corePrice")) {
          updatePatch.corePrice = resolvedCorePrice;
        }

        const nextPlan = await billingRepository.updatePlanById(plan.id, updatePatch, { trx });
        if (normalizedUpdate.entitlementsProvided) {
          const templates = mapPlanEntitlementsToTemplates(normalizedUpdate.entitlements, definitionByCode);
          await billingRepository.replacePlanEntitlementTemplates(plan.id, templates, { trx });
        }

        const persistedTemplates = await billingRepository.listPlanEntitlementTemplates(plan.id, { trx });
        const entitlements = mapPlanTemplatesToConsoleEntitlements(persistedTemplates, definitionById);
        return {
          ...nextPlan,
          entitlements
        };
      });

      return {
        provider: activeBillingProvider,
        plan: updatedPlan
      };
    } catch (error) {
      const mappedError = mapBillingPlanDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
  }

  async function updateBillingProduct(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    ensureBillingProductCatalogRepository(billingRepository);

    const productId = parsePositiveInteger(params?.productId);
    if (!productId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            productId: "productId is required."
          }
        }
      });
    }

    const normalizedUpdate = normalizeBillingCatalogProductUpdatePayload(payload, {
      activeBillingProvider
    });
    const resolvedPrice = normalizedUpdate.patch.price
      ? await resolveCatalogProductPriceForUpdate({
          activeBillingProvider,
          billingProviderAdapter,
          price: normalizedUpdate.patch.price
        })
      : null;

    try {
      const updatedProduct = await billingRepository.transaction(async (trx) => {
        const definitions = await billingRepository.listEntitlementDefinitions(
          {
            includeInactive: true
          },
          { trx }
        );
        const definitionByCode = new Map(definitions.map((entry) => [String(entry.code || ""), entry]));
        const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
        const product = await billingRepository.findProductById(productId, { trx });
        if (!product) {
          throw new AppError(404, "Billing product not found.");
        }

        const updatePatch = {
          ...normalizedUpdate.patch
        };
        if (resolvedPrice) {
          updatePatch.price = resolvedPrice;
        }

        const nextProduct = await billingRepository.updateProductById(product.id, updatePatch, { trx });
        if (normalizedUpdate.entitlementsProvided) {
          const templates = mapProductEntitlementsToTemplates(normalizedUpdate.entitlements, definitionByCode);
          await billingRepository.replaceProductEntitlementTemplates(product.id, templates, { trx });
        }
        const persistedTemplates = await billingRepository.listProductEntitlementTemplates(product.id, { trx });

        return {
          ...nextProduct,
          entitlements: mapProductTemplatesToConsoleEntitlements(persistedTemplates, definitionById)
        };
      });

      return {
        provider: activeBillingProvider,
        product: updatedProduct
      };
    } catch (error) {
      const mappedError = mapBillingProductDuplicateError(error);
      if (mappedError) {
        throw mappedError;
      }
      throw error;
    }
  }

  async function listEntitlementDefinitions(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingRepository || typeof billingRepository.listEntitlementDefinitions !== "function") {
      throw new AppError(501, "Console billing catalog is not available.");
    }

    const includeInactive = normalizeOptionalBoolean(query?.includeInactive, true);
    const codes = normalizeCodeFilters(query?.codes);
    const singleCode = normalizeOptionalString(query?.code);
    if (singleCode && !codes.includes(singleCode)) {
      codes.push(singleCode);
    }

    const definitions = await billingRepository.listEntitlementDefinitions({
      includeInactive,
      codes: codes.length > 0 ? codes : null
    });

    return {
      entries: (Array.isArray(definitions) ? definitions : [])
        .map((entry) => mapEntitlementDefinitionToConsole(entry))
        .filter(Boolean)
    };
  }

  async function getEntitlementDefinition(user, params = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);

    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }

    if (!billingRepository || typeof billingRepository.findEntitlementDefinitionById !== "function") {
      throw new AppError(501, "Console billing catalog is not available.");
    }

    const definitionId = parsePositiveInteger(params?.definitionId);
    if (!definitionId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            definitionId: "definitionId is required."
          }
        }
      });
    }

    const definition = await billingRepository.findEntitlementDefinitionById(definitionId);
    const mappedDefinition = mapEntitlementDefinitionToConsole(definition);
    if (!mappedDefinition) {
      throw new AppError(404, "Entitlement definition not found.");
    }

    return {
      definition: mappedDefinition
    };
  }

  async function createEntitlementDefinition(user, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.entitlement_definition.create");
  }

  async function updateEntitlementDefinition(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.entitlement_definition.update");
  }

  async function deleteEntitlementDefinition(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.entitlement_definition.delete");
  }

  async function archiveBillingPlan(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.plan.archive");
  }

  async function unarchiveBillingPlan(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.plan.unarchive");
  }

  async function deleteBillingPlan(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.plan.delete");
  }

  async function archiveBillingProduct(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.product.archive");
  }

  async function unarchiveBillingProduct(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.product.unarchive");
  }

  async function deleteBillingProduct(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.CATALOG_MANAGE);
    void params;
    void payload;
    throw createNotImplementedBillingOperationError("console.billing.product.delete");
  }

  async function listPurchasesForConsole(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (!billingRepository || typeof billingRepository.listBillingPurchasesForConsole !== "function") {
      throw new AppError(501, "Console purchase listing is not available.");
    }

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 25,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const rows = await billingRepository.listBillingPurchasesForConsole({
      billableEntityId: normalizePositiveInteger(query?.billableEntityId) || null,
      workspaceSlug: normalizeOptionalString(query?.workspaceSlug) || null,
      ownerUserId: normalizePositiveInteger(query?.userId) || null,
      status: normalizeOptionalString(query?.status) || null,
      provider: normalizeOptionalString(query?.provider) || null,
      operationKey: normalizeOptionalString(query?.operationKey) || null,
      purchaseKind: normalizeOptionalString(query?.purchaseKind) || null,
      from: normalizeOptionalDateTime(query?.from),
      to: normalizeOptionalDateTime(query?.to),
      limit: fetchLimit,
      offset: 0
    });

    const hasMore = rows.length > startIndex + pagination.pageSize;
    const entries = rows.slice(startIndex, startIndex + pagination.pageSize).map(mapPurchaseToConsole).filter(Boolean);

    return {
      entries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function resolvePurchaseMutationContext({ purchaseId, payload = {}, user, actionType, failureCode }) {
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (
      !billingRepository ||
      typeof billingRepository.findBillingPurchaseById !== "function" ||
      typeof billingRepository.insertPurchaseAdjustment !== "function"
    ) {
      throw new AppError(501, "Console purchase operations are not available.");
    }

    const normalizedPurchaseId = parsePositiveInteger(purchaseId);
    if (!normalizedPurchaseId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            purchaseId: "purchaseId is required."
          }
        }
      });
    }

    const idempotencyKey = resolveClientIdempotencyKey(payload);
    if (!idempotencyKey) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            idempotencyKey: "idempotencyKey is required."
          }
        }
      });
    }

    const existingAdjustment =
      typeof billingRepository.findPurchaseAdjustmentByIdempotencyKey === "function"
        ? await billingRepository.findPurchaseAdjustmentByIdempotencyKey(idempotencyKey)
        : null;
    if (existingAdjustment) {
      const existingActionType = normalizeOptionalString(existingAdjustment.actionType).toLowerCase();
      const normalizedActionType = normalizeOptionalString(actionType).toLowerCase();
      if (Number(existingAdjustment.purchaseId) !== normalizedPurchaseId) {
        throw createConsolePurchaseError(
          409,
          "Purchase adjustment idempotency key is already used for another purchase.",
          "PURCHASE_ADJUSTMENT_DUPLICATE",
          {
            purchaseId: normalizedPurchaseId,
            existingPurchaseId: Number(existingAdjustment.purchaseId)
          }
        );
      }
      if (existingActionType && existingActionType !== normalizedActionType) {
        throw createConsolePurchaseError(
          409,
          "Purchase adjustment idempotency key is already used for another action.",
          "PURCHASE_ADJUSTMENT_DUPLICATE",
          {
            purchaseId: normalizedPurchaseId,
            actionType: normalizedActionType,
            existingActionType
          }
        );
      }

      const purchase = await billingRepository.findBillingPurchaseById(normalizedPurchaseId);
      const adjustments =
        typeof billingRepository.listPurchaseAdjustmentsByPurchaseId === "function"
          ? await billingRepository.listPurchaseAdjustmentsByPurchaseId({
              purchaseId: normalizedPurchaseId,
              limit: 50
            })
          : [existingAdjustment];
      return {
        replay: true,
        purchase,
        adjustment: existingAdjustment,
        adjustments
      };
    }

    const purchase = await billingRepository.findBillingPurchaseById(normalizedPurchaseId);
    if (!purchase) {
      throw createConsolePurchaseError(404, "Billing purchase not found.", "PURCHASE_NOT_FOUND", {
        purchaseId: normalizedPurchaseId
      });
    }

    async function recordAdjustment({
      status,
      amountMinor = null,
      currency = null,
      reasonCode = null,
      providerReference = null,
      metadataJson = {}
    }) {
      try {
        return await billingRepository.insertPurchaseAdjustment({
          purchaseId: purchase.id,
          actionType,
          status,
          amountMinor,
          currency,
          reasonCode,
          providerReference,
          requestedByUserId: normalizePositiveInteger(user?.id) || null,
          requestIdempotencyKey: idempotencyKey,
          metadataJson
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) {
          throw error;
        }

        const duplicate =
          typeof billingRepository.findPurchaseAdjustmentByIdempotencyKey === "function"
            ? await billingRepository.findPurchaseAdjustmentByIdempotencyKey(idempotencyKey)
            : null;
        if (duplicate) {
          const duplicatePurchaseId = Number(duplicate.purchaseId);
          const duplicateActionType = normalizeOptionalString(duplicate.actionType).toLowerCase();
          const normalizedActionType = normalizeOptionalString(actionType).toLowerCase();
          if (duplicatePurchaseId !== Number(purchase.id) || (duplicateActionType && duplicateActionType !== normalizedActionType)) {
            throw createConsolePurchaseError(
              409,
              "Purchase adjustment idempotency key is already used for another command.",
              "PURCHASE_ADJUSTMENT_DUPLICATE",
              {
                purchaseId: Number(purchase.id),
                actionType: normalizedActionType,
                existingPurchaseId: duplicatePurchaseId || null,
                existingActionType: duplicateActionType || null
              }
            );
          }
          return duplicate;
        }

        throw createConsolePurchaseError(
          409,
          "Purchase adjustment already exists for this idempotency key.",
          "PURCHASE_ADJUSTMENT_DUPLICATE",
          {
            purchaseId: purchase.id,
            requestIdempotencyKey: idempotencyKey
          }
        );
      }
    }

    async function buildResponse({ nextPurchase, adjustment }) {
      const adjustments =
        typeof billingRepository.listPurchaseAdjustmentsByPurchaseId === "function"
          ? await billingRepository.listPurchaseAdjustmentsByPurchaseId({
              purchaseId: purchase.id,
              limit: 50
            })
          : [adjustment];
      return {
        purchase: mapPurchaseToConsole(nextPurchase || purchase),
        adjustment: mapPurchaseAdjustmentToConsole(adjustment),
        adjustments: (Array.isArray(adjustments) ? adjustments : []).map(mapPurchaseAdjustmentToConsole).filter(Boolean)
      };
    }

    async function failWithRecordedAdjustment(message, details = {}) {
      await recordAdjustment({
        status: "failed",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: details.reasonCode || `${actionType}_not_allowed`,
        metadataJson: details
      });
      throw createConsolePurchaseError(409, message, failureCode, {
        purchaseId: purchase.id,
        status: purchase.status
      });
    }

    return {
      replay: false,
      purchase,
      idempotencyKey,
      recordAdjustment,
      buildResponse,
      failWithRecordedAdjustment
    };
  }

  async function refundPurchaseForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    const context = await resolvePurchaseMutationContext({
      purchaseId: params?.purchaseId,
      payload,
      user,
      actionType: "refund",
      failureCode: "PURCHASE_REFUND_NOT_ALLOWED"
    });
    if (context.replay) {
      return {
        purchase: mapPurchaseToConsole(context.purchase),
        adjustment: mapPurchaseAdjustmentToConsole(context.adjustment),
        adjustments: (Array.isArray(context.adjustments) ? context.adjustments : [])
          .map(mapPurchaseAdjustmentToConsole)
          .filter(Boolean)
      };
    }

    const purchase = context.purchase;
    const status = normalizeOptionalString(purchase?.status).toLowerCase();
    if (status === "refunded") {
      const adjustment = await context.recordAdjustment({
        status: "noop",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "refund_already_applied",
        metadataJson: {
          status
        }
      });
      return context.buildResponse({
        nextPurchase: purchase,
        adjustment
      });
    }
    if (status !== "confirmed") {
      await context.failWithRecordedAdjustment("Purchase refund is not allowed for current status.", {
        status,
        reasonCode: "refund_not_allowed"
      });
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.refundPurchase !== "function") {
      await context.recordAdjustment({
        status: "failed",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "provider_operation_not_supported",
        metadataJson: {
          provider: purchase.provider
        }
      });
      throw createConsolePurchaseError(
        501,
        "Provider purchase refund operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          purchaseId: purchase.id
        }
      );
    }

    let providerReference = null;
    try {
      const providerResult = await billingProviderAdapter.refundPurchase({
        purchase,
        purchaseId: purchase.id,
        providerPaymentId: purchase.providerPaymentId,
        providerInvoiceId: purchase.providerInvoiceId,
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: normalizeOptionalString(payload?.reasonCode) || null,
        metadataJson: payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {},
        idempotencyKey: context.idempotencyKey
      });
      providerReference =
        normalizeOptionalString(providerResult?.providerReference) ||
        normalizeOptionalString(providerResult?.id) ||
        null;
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status);
      const errorCode = normalizeOptionalString(error?.code || error?.details?.code).toUpperCase();
      if (statusCode === 501 || errorCode === "PROVIDER_OPERATION_NOT_SUPPORTED") {
        await context.recordAdjustment({
          status: "failed",
          amountMinor: purchase.amountMinor,
          currency: purchase.currency,
          reasonCode: "provider_operation_not_supported",
          metadataJson: {
            provider: purchase.provider
          }
        });
        throw createConsolePurchaseError(
          501,
          "Provider purchase refund operation is not supported.",
          "PROVIDER_OPERATION_NOT_SUPPORTED",
          {
            purchaseId: purchase.id
          }
        );
      }

      await context.recordAdjustment({
        status: "failed",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "provider_refund_failed",
        metadataJson: {
          provider: purchase.provider,
          error: String(error?.message || "Provider purchase refund failed.")
        }
      });
      throw createConsolePurchaseError(409, "Purchase refund is not allowed.", "PURCHASE_REFUND_NOT_ALLOWED", {
        purchaseId: purchase.id
      });
    }

    const nextPurchase =
      typeof billingRepository.updateBillingPurchaseStatusById === "function"
        ? await billingRepository.updateBillingPurchaseStatusById(purchase.id, {
            status: "refunded"
          })
        : purchase;

    const adjustment = await context.recordAdjustment({
      status: "succeeded",
      amountMinor: purchase.amountMinor,
      currency: purchase.currency,
      reasonCode: normalizeOptionalString(payload?.reasonCode) || "manual_refund",
      providerReference,
      metadataJson: payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {}
    });

    return context.buildResponse({
      nextPurchase,
      adjustment
    });
  }

  async function voidPurchaseForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    const context = await resolvePurchaseMutationContext({
      purchaseId: params?.purchaseId,
      payload,
      user,
      actionType: "void",
      failureCode: "PURCHASE_VOID_NOT_ALLOWED"
    });
    if (context.replay) {
      return {
        purchase: mapPurchaseToConsole(context.purchase),
        adjustment: mapPurchaseAdjustmentToConsole(context.adjustment),
        adjustments: (Array.isArray(context.adjustments) ? context.adjustments : [])
          .map(mapPurchaseAdjustmentToConsole)
          .filter(Boolean)
      };
    }

    const purchase = context.purchase;
    const status = normalizeOptionalString(purchase?.status).toLowerCase();
    if (status === "voided") {
      const adjustment = await context.recordAdjustment({
        status: "noop",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "void_already_applied",
        metadataJson: {
          status
        }
      });
      return context.buildResponse({
        nextPurchase: purchase,
        adjustment
      });
    }
    if (status !== "confirmed") {
      await context.failWithRecordedAdjustment("Purchase void is not allowed for current status.", {
        status,
        reasonCode: "void_not_allowed"
      });
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.voidPurchase !== "function") {
      await context.recordAdjustment({
        status: "failed",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "provider_operation_not_supported",
        metadataJson: {
          provider: purchase.provider
        }
      });
      throw createConsolePurchaseError(
        501,
        "Provider purchase void operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          purchaseId: purchase.id
        }
      );
    }

    let providerReference = null;
    try {
      const providerResult = await billingProviderAdapter.voidPurchase({
        purchase,
        purchaseId: purchase.id,
        providerPaymentId: purchase.providerPaymentId,
        providerInvoiceId: purchase.providerInvoiceId,
        reasonCode: normalizeOptionalString(payload?.reasonCode) || null,
        metadataJson: payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {},
        idempotencyKey: context.idempotencyKey
      });
      providerReference =
        normalizeOptionalString(providerResult?.providerReference) ||
        normalizeOptionalString(providerResult?.id) ||
        null;
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status);
      const errorCode = normalizeOptionalString(error?.code || error?.details?.code).toUpperCase();
      if (statusCode === 501 || errorCode === "PROVIDER_OPERATION_NOT_SUPPORTED") {
        await context.recordAdjustment({
          status: "failed",
          amountMinor: purchase.amountMinor,
          currency: purchase.currency,
          reasonCode: "provider_operation_not_supported",
          metadataJson: {
            provider: purchase.provider
          }
        });
        throw createConsolePurchaseError(
          501,
          "Provider purchase void operation is not supported.",
          "PROVIDER_OPERATION_NOT_SUPPORTED",
          {
            purchaseId: purchase.id
          }
        );
      }

      await context.recordAdjustment({
        status: "failed",
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reasonCode: "provider_void_failed",
        metadataJson: {
          provider: purchase.provider,
          error: String(error?.message || "Provider purchase void failed.")
        }
      });
      throw createConsolePurchaseError(409, "Purchase void is not allowed.", "PURCHASE_VOID_NOT_ALLOWED", {
        purchaseId: purchase.id
      });
    }

    const nextPurchase =
      typeof billingRepository.updateBillingPurchaseStatusById === "function"
        ? await billingRepository.updateBillingPurchaseStatusById(purchase.id, {
            status: "voided"
          })
        : purchase;

    const adjustment = await context.recordAdjustment({
      status: "succeeded",
      amountMinor: purchase.amountMinor,
      currency: purchase.currency,
      reasonCode: normalizeOptionalString(payload?.reasonCode) || "manual_void",
      providerReference,
      metadataJson: payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {}
    });

    return context.buildResponse({
      nextPurchase,
      adjustment
    });
  }

  async function createPurchaseCorrectionForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    const context = await resolvePurchaseMutationContext({
      purchaseId: params?.purchaseId,
      payload,
      user,
      actionType: "correction",
      failureCode: "PURCHASE_ADJUSTMENT_DUPLICATE"
    });
    if (context.replay) {
      return {
        purchase: mapPurchaseToConsole(context.purchase),
        adjustment: mapPurchaseAdjustmentToConsole(context.adjustment),
        adjustments: (Array.isArray(context.adjustments) ? context.adjustments : [])
          .map(mapPurchaseAdjustmentToConsole)
          .filter(Boolean)
      };
    }

    const amountMinor = Number(payload?.amountMinor);
    if (!Number.isInteger(amountMinor)) {
      await context.recordAdjustment({
        status: "failed",
        amountMinor: null,
        currency: null,
        reasonCode: "correction_amount_invalid",
        metadataJson: {
          amountMinor: payload?.amountMinor
        }
      });
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            amountMinor: "amountMinor must be an integer."
          }
        }
      });
    }

    const currency = normalizeOptionalString(payload?.currency || context.purchase?.currency).toUpperCase();
    if (!currency || currency.length !== 3) {
      await context.recordAdjustment({
        status: "failed",
        amountMinor,
        currency: null,
        reasonCode: "correction_currency_invalid",
        metadataJson: {
          currency: payload?.currency
        }
      });
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            currency: "currency must be a 3-letter ISO code."
          }
        }
      });
    }

    const adjustment = await context.recordAdjustment({
      status: "recorded",
      amountMinor,
      currency,
      reasonCode: normalizeOptionalString(payload?.reasonCode) || "manual_correction",
      metadataJson: payload?.metadataJson && typeof payload.metadataJson === "object" ? payload.metadataJson : {}
    });

    return context.buildResponse({
      nextPurchase: context.purchase,
      adjustment
    });
  }

  async function listPlanAssignmentsForConsole(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (!billingRepository || typeof billingRepository.listPlanAssignmentsForConsole !== "function") {
      throw new AppError(501, "Console plan assignment operations are not available.");
    }

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 25,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const rows = await billingRepository.listPlanAssignmentsForConsole({
      billableEntityId: normalizePositiveInteger(query?.billableEntityId) || null,
      workspaceSlug: normalizeOptionalString(query?.workspaceSlug) || null,
      statuses: normalizePlanAssignmentStatusFilters(query?.statuses || query?.status),
      source: normalizeOptionalString(query?.source) || null,
      planCode: normalizeOptionalString(query?.planCode) || null,
      from: normalizeOptionalDateTime(query?.from),
      to: normalizeOptionalDateTime(query?.to),
      limit: fetchLimit,
      offset: 0
    });

    const hasMore = rows.length > startIndex + pagination.pageSize;
    const entries = rows.slice(startIndex, startIndex + pagination.pageSize).map(mapPlanAssignmentToConsole).filter(Boolean);
    return {
      entries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function createPlanAssignmentForConsole(user, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (
      !billingRepository ||
      typeof billingRepository.findBillableEntityById !== "function" ||
      typeof billingRepository.findPlanById !== "function" ||
      typeof billingRepository.insertPlanAssignment !== "function"
    ) {
      throw new AppError(501, "Console plan assignment operations are not available.");
    }

    const body = normalizeObject(payload);
    const billableEntityId = normalizePositiveInteger(body.billableEntityId);
    const planId = normalizePositiveInteger(body.planId || body.targetPlanId);
    const fieldErrors = {};

    if (!billableEntityId) {
      fieldErrors.billableEntityId = "billableEntityId is required.";
    }
    if (!planId) {
      fieldErrors.planId = "planId is required.";
    }

    const statusInput = normalizeOptionalString(body.status).toLowerCase();
    if (statusInput && !PLAN_ASSIGNMENT_STATUS_SET.has(statusInput)) {
      fieldErrors.status = "status must be one of current, upcoming, past, canceled.";
    }

    const sourceInput = normalizeOptionalString(body.source).toLowerCase();
    if (sourceInput && !PLAN_ASSIGNMENT_SOURCE_SET.has(sourceInput)) {
      fieldErrors.source = "source must be one of internal, promo, manual.";
    }

    const periodStartAtInput = Object.hasOwn(body, "periodStartAt") ? body.periodStartAt : body.effectiveAt;
    const periodStartAt = normalizeOptionalDateTime(periodStartAtInput) || new Date();
    if (Object.hasOwn(body, "periodStartAt") && !normalizeOptionalDateTime(body.periodStartAt)) {
      fieldErrors.periodStartAt = "periodStartAt must be a valid date-time.";
    }
    if (Object.hasOwn(body, "effectiveAt") && !normalizeOptionalDateTime(body.effectiveAt)) {
      fieldErrors.effectiveAt = "effectiveAt must be a valid date-time.";
    }

    let explicitPeriodEndAt = undefined;
    if (Object.hasOwn(body, "periodEndAt")) {
      if (body.periodEndAt == null || String(body.periodEndAt).trim() === "") {
        explicitPeriodEndAt = null;
      } else {
        const parsedPeriodEndAt = normalizeOptionalDateTime(body.periodEndAt);
        if (!parsedPeriodEndAt) {
          fieldErrors.periodEndAt = "periodEndAt must be a valid date-time or null.";
        } else {
          explicitPeriodEndAt = parsedPeriodEndAt;
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors
        }
      });
    }

    const [billableEntity, plan] = await Promise.all([
      billingRepository.findBillableEntityById(billableEntityId),
      billingRepository.findPlanById(planId)
    ]);

    if (!billableEntity) {
      throw new AppError(404, "Billable entity not found.", {
        code: "BILLABLE_ENTITY_NOT_FOUND",
        details: {
          code: "BILLABLE_ENTITY_NOT_FOUND",
          billableEntityId
        }
      });
    }
    if (!plan) {
      throw new AppError(404, "Billing plan not found.", {
        code: "PLAN_NOT_FOUND",
        details: {
          code: "PLAN_NOT_FOUND",
          planId
        }
      });
    }

    const periodEndAt =
      explicitPeriodEndAt === undefined ? resolvePlanDefaultPeriodEndAt(plan, periodStartAt) : explicitPeriodEndAt;
    if (periodEndAt && periodEndAt.getTime() <= periodStartAt.getTime()) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            periodEndAt: "periodEndAt must be after periodStartAt."
          }
        }
      });
    }

    const metadataJson =
      Object.hasOwn(body, "metadataJson") && body.metadataJson == null
        ? null
        : body.metadataJson && typeof body.metadataJson === "object" && !Array.isArray(body.metadataJson)
          ? body.metadataJson
          : {};
    if (
      Object.hasOwn(body, "metadataJson") &&
      body.metadataJson != null &&
      (typeof body.metadataJson !== "object" || Array.isArray(body.metadataJson))
    ) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            metadataJson: "metadataJson must be an object."
          }
        }
      });
    }

    let createdAssignment = null;
    try {
      createdAssignment = await billingRepository.insertPlanAssignment({
        billableEntityId,
        planId,
        source: normalizePlanAssignmentSource(body.source, "manual"),
        status: normalizePlanAssignmentStatus(body.status, "current"),
        periodStartAt,
        periodEndAt,
        metadataJson
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      throw new AppError(409, "Plan assignment conflicts with existing assignment invariants.", {
        code: "BILLING_DEPENDENCY_CONFLICT",
        details: {
          code: "BILLING_DEPENDENCY_CONFLICT",
          billableEntityId,
          status: normalizePlanAssignmentStatus(body.status, "current")
        }
      });
    }

    const hydrated =
      typeof billingRepository.listPlanAssignmentsForConsole === "function"
        ? await billingRepository.listPlanAssignmentsForConsole({
            assignmentId: createdAssignment?.id,
            limit: 1,
            offset: 0
          })
        : [];
    const assignment = mapPlanAssignmentToConsole((Array.isArray(hydrated) && hydrated[0]) || createdAssignment);
    return {
      assignment
    };
  }

  async function updatePlanAssignmentForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (
      !billingRepository ||
      typeof billingRepository.findPlanAssignmentById !== "function" ||
      typeof billingRepository.updatePlanAssignmentById !== "function"
    ) {
      throw new AppError(501, "Console plan assignment operations are not available.");
    }

    const assignmentId = parsePositiveInteger(params?.assignmentId);
    if (!assignmentId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            assignmentId: "assignmentId is required."
          }
        }
      });
    }

    const existing = await billingRepository.findPlanAssignmentById(assignmentId);
    if (!existing) {
      throw new AppError(404, "Plan assignment not found.", {
        code: "PLAN_ASSIGNMENT_NOT_FOUND",
        details: {
          code: "PLAN_ASSIGNMENT_NOT_FOUND",
          assignmentId
        }
      });
    }

    const body = normalizeObject(payload);
    const fieldErrors = {};
    const patch = {};

    if (Object.hasOwn(body, "planId") || Object.hasOwn(body, "targetPlanId")) {
      const nextPlanId = normalizePositiveInteger(body.planId || body.targetPlanId);
      if (!nextPlanId) {
        fieldErrors.planId = "planId must be a positive integer.";
      } else {
        const plan =
          typeof billingRepository.findPlanById === "function" ? await billingRepository.findPlanById(nextPlanId) : null;
        if (!plan) {
          throw new AppError(404, "Billing plan not found.", {
            code: "PLAN_NOT_FOUND",
            details: {
              code: "PLAN_NOT_FOUND",
              planId: nextPlanId
            }
          });
        }
        patch.planId = nextPlanId;
      }
    }

    if (Object.hasOwn(body, "source")) {
      const nextSource = normalizeOptionalString(body.source).toLowerCase();
      if (!PLAN_ASSIGNMENT_SOURCE_SET.has(nextSource)) {
        fieldErrors.source = "source must be one of internal, promo, manual.";
      } else {
        patch.source = nextSource;
      }
    }

    if (Object.hasOwn(body, "status")) {
      const nextStatus = normalizeOptionalString(body.status).toLowerCase();
      if (!PLAN_ASSIGNMENT_STATUS_SET.has(nextStatus)) {
        fieldErrors.status = "status must be one of current, upcoming, past, canceled.";
      } else {
        patch.status = nextStatus;
      }
    }

    if (Object.hasOwn(body, "periodStartAt")) {
      const parsedPeriodStartAt = normalizeOptionalDateTime(body.periodStartAt);
      if (!parsedPeriodStartAt) {
        fieldErrors.periodStartAt = "periodStartAt must be a valid date-time.";
      } else {
        patch.periodStartAt = parsedPeriodStartAt;
      }
    }

    if (Object.hasOwn(body, "periodEndAt")) {
      if (body.periodEndAt == null || String(body.periodEndAt).trim() === "") {
        patch.periodEndAt = null;
      } else {
        const parsedPeriodEndAt = normalizeOptionalDateTime(body.periodEndAt);
        if (!parsedPeriodEndAt) {
          fieldErrors.periodEndAt = "periodEndAt must be a valid date-time or null.";
        } else {
          patch.periodEndAt = parsedPeriodEndAt;
        }
      }
    }

    if (Object.hasOwn(body, "metadataJson")) {
      if (body.metadataJson == null) {
        patch.metadataJson = null;
      } else if (typeof body.metadataJson === "object" && !Array.isArray(body.metadataJson)) {
        patch.metadataJson = body.metadataJson;
      } else {
        fieldErrors.metadataJson = "metadataJson must be an object or null.";
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors
        }
      });
    }
    if (Object.keys(patch).length < 1) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            body: "At least one assignment field must be provided."
          }
        }
      });
    }

    const nextPeriodStartAt = patch.periodStartAt || normalizeOptionalDateTime(existing.periodStartAt);
    const nextPeriodEndAt =
      Object.hasOwn(patch, "periodEndAt") ? patch.periodEndAt : normalizeOptionalDateTime(existing.periodEndAt);
    if (nextPeriodStartAt && nextPeriodEndAt && nextPeriodEndAt.getTime() <= nextPeriodStartAt.getTime()) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            periodEndAt: "periodEndAt must be after periodStartAt."
          }
        }
      });
    }

    let updatedAssignment = null;
    try {
      updatedAssignment = await billingRepository.updatePlanAssignmentById(assignmentId, patch);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      throw new AppError(409, "Plan assignment conflicts with existing assignment invariants.", {
        code: "BILLING_DEPENDENCY_CONFLICT",
        details: {
          code: "BILLING_DEPENDENCY_CONFLICT",
          assignmentId,
          billableEntityId: existing.billableEntityId
        }
      });
    }

    const hydrated =
      typeof billingRepository.listPlanAssignmentsForConsole === "function"
        ? await billingRepository.listPlanAssignmentsForConsole({
            assignmentId,
            limit: 1,
            offset: 0
          })
        : [];
    const assignment = mapPlanAssignmentToConsole((Array.isArray(hydrated) && hydrated[0]) || updatedAssignment);
    return {
      assignment
    };
  }

  async function cancelPlanAssignmentForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (
      !billingRepository ||
      typeof billingRepository.findPlanAssignmentById !== "function" ||
      typeof billingRepository.updatePlanAssignmentById !== "function"
    ) {
      throw new AppError(501, "Console plan assignment operations are not available.");
    }

    const assignmentId = parsePositiveInteger(params?.assignmentId);
    if (!assignmentId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            assignmentId: "assignmentId is required."
          }
        }
      });
    }

    const existing = await billingRepository.findPlanAssignmentById(assignmentId);
    if (!existing) {
      throw new AppError(404, "Plan assignment not found.", {
        code: "PLAN_ASSIGNMENT_NOT_FOUND",
        details: {
          code: "PLAN_ASSIGNMENT_NOT_FOUND",
          assignmentId
        }
      });
    }

    if (normalizeOptionalString(existing.status).toLowerCase() === "canceled") {
      const hydrated =
        typeof billingRepository.listPlanAssignmentsForConsole === "function"
          ? await billingRepository.listPlanAssignmentsForConsole({
              assignmentId,
              limit: 1,
              offset: 0
            })
          : [];
      return {
        assignment: mapPlanAssignmentToConsole((Array.isArray(hydrated) && hydrated[0]) || existing)
      };
    }

    const body = normalizeObject(payload);
    if (
      Object.hasOwn(body, "metadataJson") &&
      body.metadataJson != null &&
      (typeof body.metadataJson !== "object" || Array.isArray(body.metadataJson))
    ) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            metadataJson: "metadataJson must be an object."
          }
        }
      });
    }

    const metadataJson = {
      ...(existing.metadataJson && typeof existing.metadataJson === "object" ? existing.metadataJson : {}),
      ...(body.metadataJson && typeof body.metadataJson === "object" ? body.metadataJson : {}),
      canceledByUserId: normalizePositiveInteger(user?.id) || null
    };
    const reasonCode = normalizeOptionalString(body.reasonCode);
    if (reasonCode) {
      metadataJson.reasonCode = reasonCode;
    }

    let canceled = null;
    try {
      canceled = await billingRepository.updatePlanAssignmentById(assignmentId, {
        status: "canceled",
        metadataJson
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }

      throw new AppError(409, "Plan assignment conflicts with existing assignment invariants.", {
        code: "BILLING_DEPENDENCY_CONFLICT",
        details: {
          code: "BILLING_DEPENDENCY_CONFLICT",
          assignmentId,
          billableEntityId: existing.billableEntityId
        }
      });
    }

    const hydrated =
      typeof billingRepository.listPlanAssignmentsForConsole === "function"
        ? await billingRepository.listPlanAssignmentsForConsole({
            assignmentId,
            limit: 1,
            offset: 0
          })
        : [];
    return {
      assignment: mapPlanAssignmentToConsole((Array.isArray(hydrated) && hydrated[0]) || canceled)
    };
  }

  async function listSubscriptionsForConsole(user, query = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (!billingRepository || typeof billingRepository.listSubscriptionsForConsole !== "function") {
      throw new AppError(501, "Console subscription operations are not available.");
    }

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 25,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const rows = await billingRepository.listSubscriptionsForConsole({
      provider: normalizeOptionalString(query?.provider) || null,
      providerSubscriptionId: normalizeOptionalString(query?.providerSubscriptionId) || null,
      billableEntityId: normalizePositiveInteger(query?.billableEntityId) || null,
      workspaceSlug: normalizeOptionalString(query?.workspaceSlug) || null,
      status: normalizeOptionalString(query?.status) || null,
      planCode: normalizeOptionalString(query?.planCode) || null,
      from: normalizeOptionalDateTime(query?.from),
      to: normalizeOptionalDateTime(query?.to),
      limit: fetchLimit,
      offset: 0
    });

    const hasMore = rows.length > startIndex + pagination.pageSize;
    const entries = rows.slice(startIndex, startIndex + pagination.pageSize).map(mapSubscriptionToConsole).filter(Boolean);
    return {
      entries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function changeSubscriptionPlanForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (
      !billingRepository ||
      typeof billingRepository.listSubscriptionsForConsole !== "function" ||
      typeof billingRepository.findPlanById !== "function" ||
      typeof billingRepository.findPlanByCode !== "function"
    ) {
      throw new AppError(501, "Console subscription operations are not available.");
    }

    const providerSubscriptionId = normalizeOptionalString(params?.providerSubscriptionId);
    if (!providerSubscriptionId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            providerSubscriptionId: "providerSubscriptionId is required."
          }
        }
      });
    }

    const body = normalizeObject(payload);
    const planId = normalizePositiveInteger(body.planId || body.targetPlanId);
    const planCode = normalizeOptionalString(body.planCode || body.targetPlanCode);
    if (!planId && !planCode) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            planId: "planId or planCode is required."
          }
        }
      });
    }

    const subscriptions = await billingRepository.listSubscriptionsForConsole({
      provider: normalizeOptionalString(body.provider) || null,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const currentSubscription = mapSubscriptionToConsole(Array.isArray(subscriptions) ? subscriptions[0] : null);
    if (!currentSubscription) {
      throw createConsoleSubscriptionError(404, "Subscription not found.", "SUBSCRIPTION_NOT_FOUND", {
        providerSubscriptionId
      });
    }

    const targetPlan = planId ? await billingRepository.findPlanById(planId) : await billingRepository.findPlanByCode(planCode);
    if (!targetPlan) {
      throw new AppError(404, "Billing plan not found.", {
        code: "PLAN_NOT_FOUND",
        details: {
          code: "PLAN_NOT_FOUND",
          ...(planId ? { planId } : { planCode })
        }
      });
    }

    const targetProviderPriceId = normalizeOptionalString(targetPlan?.corePrice?.providerPriceId);
    if (!targetProviderPriceId) {
      throw new AppError(409, "Target plan does not provide a recurring provider price.", {
        code: "BILLING_DEPENDENCY_CONFLICT",
        details: {
          code: "BILLING_DEPENDENCY_CONFLICT",
          planId: Number(targetPlan.id)
        }
      });
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.updateSubscriptionPlan !== "function") {
      throw createConsoleSubscriptionError(
        501,
        "Provider subscription plan change operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          providerSubscriptionId
        }
      );
    }

    let providerSubscription = null;
    try {
      providerSubscription = await billingProviderAdapter.updateSubscriptionPlan({
        subscriptionId: providerSubscriptionId,
        providerPriceId: targetProviderPriceId,
        prorationBehavior: normalizeOptionalString(body.prorationBehavior) || "create_prorations",
        billingCycleAnchor: normalizeOptionalString(body.billingCycleAnchor) || "unchanged"
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const errorCode = normalizeOptionalString(error?.code || error?.details?.code).toUpperCase();
      if (statusCode === 501 || errorCode === "PROVIDER_OPERATION_NOT_SUPPORTED") {
        throw createConsoleSubscriptionError(
          501,
          "Provider subscription plan change operation is not supported.",
          "PROVIDER_OPERATION_NOT_SUPPORTED",
          {
            providerSubscriptionId
          }
        );
      }

      throw createConsoleSubscriptionError(409, "Subscription plan change failed.", "BILLING_DEPENDENCY_CONFLICT", {
        providerSubscriptionId
      });
    }

    const assignmentId = normalizePositiveInteger(currentSubscription.assignmentId);
    const providerStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status || currentSubscription.status);
    const providerCreatedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.created) ||
      normalizeOptionalDateTime(currentSubscription.providerSubscriptionCreatedAt) ||
      new Date();
    const providerCurrentPeriodEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.current_period_end) ||
      normalizeOptionalDateTime(currentSubscription.currentPeriodEnd) ||
      null;
    const providerTrialEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.trial_end) || normalizeOptionalDateTime(currentSubscription.trialEnd) || null;
    const providerCanceledAt =
      parseUnixEpochSecondsToDate(providerSubscription?.canceled_at) ||
      normalizeOptionalDateTime(currentSubscription.canceledAt) ||
      null;
    const providerEndedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.ended_at) || normalizeOptionalDateTime(currentSubscription.endedAt) || null;
    const providerCustomerId =
      resolveProviderObjectId(providerSubscription?.customer) || currentSubscription.providerCustomerId || null;

    if (assignmentId && typeof billingRepository.updatePlanAssignmentById === "function") {
      await billingRepository.updatePlanAssignmentById(assignmentId, {
        planId: Number(targetPlan.id),
        ...(providerCurrentPeriodEnd ? { periodEndAt: providerCurrentPeriodEnd } : {})
      });
    }
    if (assignmentId && typeof billingRepository.upsertPlanAssignmentProviderDetails === "function") {
      await billingRepository.upsertPlanAssignmentProviderDetails({
        billingPlanAssignmentId: assignmentId,
        provider: currentSubscription.provider,
        providerSubscriptionId,
        providerCustomerId,
        providerStatus,
        providerSubscriptionCreatedAt: providerCreatedAt,
        currentPeriodEnd: providerCurrentPeriodEnd,
        trialEnd: providerTrialEnd,
        canceledAt: providerCanceledAt,
        cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
        endedAt: providerEndedAt,
        lastProviderEventCreatedAt: new Date(),
        lastProviderEventId: null,
        metadataJson:
          providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
            ? providerSubscription.metadata
            : currentSubscription.metadataJson || {}
      });
    }

    const refreshedRows = await billingRepository.listSubscriptionsForConsole({
      provider: currentSubscription.provider,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const refreshedSubscription = mapSubscriptionToConsole(Array.isArray(refreshedRows) ? refreshedRows[0] : null);
    return {
      subscription: refreshedSubscription || currentSubscription
    };
  }

  async function cancelSubscriptionForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (!billingRepository || typeof billingRepository.listSubscriptionsForConsole !== "function") {
      throw new AppError(501, "Console subscription operations are not available.");
    }

    const providerSubscriptionId = normalizeOptionalString(params?.providerSubscriptionId);
    if (!providerSubscriptionId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            providerSubscriptionId: "providerSubscriptionId is required."
          }
        }
      });
    }

    const body = normalizeObject(payload);
    const providerHint = normalizeOptionalString(body.provider) || null;
    const subscriptions = await billingRepository.listSubscriptionsForConsole({
      provider: providerHint,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const currentSubscription = mapSubscriptionToConsole(Array.isArray(subscriptions) ? subscriptions[0] : null);
    if (!currentSubscription) {
      throw createConsoleSubscriptionError(404, "Subscription not found.", "SUBSCRIPTION_NOT_FOUND", {
        providerSubscriptionId
      });
    }

    if (!billingProviderAdapter || typeof billingProviderAdapter.cancelSubscription !== "function") {
      throw createConsoleSubscriptionError(
        501,
        "Provider subscription cancellation operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          providerSubscriptionId
        }
      );
    }

    let providerSubscription = null;
    try {
      providerSubscription = await billingProviderAdapter.cancelSubscription({
        subscriptionId: providerSubscriptionId,
        cancelAtPeriodEnd: false
      });
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const errorCode = normalizeOptionalString(error?.code || error?.details?.code).toUpperCase();
      if (statusCode === 501 || errorCode === "PROVIDER_OPERATION_NOT_SUPPORTED") {
        throw createConsoleSubscriptionError(
          501,
          "Provider subscription cancellation operation is not supported.",
          "PROVIDER_OPERATION_NOT_SUPPORTED",
          {
            providerSubscriptionId
          }
        );
      }

      throw createConsoleSubscriptionError(409, "Subscription cancellation failed.", "BILLING_DEPENDENCY_CONFLICT", {
        providerSubscriptionId
      });
    }

    const assignmentId = normalizePositiveInteger(currentSubscription.assignmentId);
    const providerStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status || currentSubscription.status);
    const providerCreatedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.created) ||
      normalizeOptionalDateTime(currentSubscription.providerSubscriptionCreatedAt) ||
      new Date();
    const providerCurrentPeriodEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.current_period_end) ||
      normalizeOptionalDateTime(currentSubscription.currentPeriodEnd) ||
      null;
    const providerTrialEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.trial_end) || normalizeOptionalDateTime(currentSubscription.trialEnd) || null;
    const providerCanceledAt =
      parseUnixEpochSecondsToDate(providerSubscription?.canceled_at) || new Date();
    const providerEndedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.ended_at) || providerCanceledAt || new Date();
    const providerCustomerId =
      resolveProviderObjectId(providerSubscription?.customer) || currentSubscription.providerCustomerId || null;

    if (assignmentId && typeof billingRepository.upsertPlanAssignmentProviderDetails === "function") {
      await billingRepository.upsertPlanAssignmentProviderDetails({
        billingPlanAssignmentId: assignmentId,
        provider: currentSubscription.provider,
        providerSubscriptionId,
        providerCustomerId,
        providerStatus,
        providerSubscriptionCreatedAt: providerCreatedAt,
        currentPeriodEnd: providerCurrentPeriodEnd,
        trialEnd: providerTrialEnd,
        canceledAt: providerCanceledAt,
        cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
        endedAt: providerEndedAt,
        lastProviderEventCreatedAt: new Date(),
        lastProviderEventId: null,
        metadataJson:
          providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
            ? providerSubscription.metadata
            : currentSubscription.metadataJson || {}
      });
    }
    if (
      assignmentId &&
      TERMINAL_PROVIDER_SUBSCRIPTION_STATUS_SET.has(providerStatus) &&
      typeof billingRepository.updatePlanAssignmentById === "function"
    ) {
      await billingRepository.updatePlanAssignmentById(assignmentId, {
        status: "past",
        periodEndAt: providerEndedAt || providerCanceledAt || new Date()
      });
    }

    const refreshedRows = await billingRepository.listSubscriptionsForConsole({
      provider: currentSubscription.provider,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const refreshedSubscription = mapSubscriptionToConsole(Array.isArray(refreshedRows) ? refreshedRows[0] : null);
    return {
      subscription: refreshedSubscription || currentSubscription
    };
  }

  async function cancelSubscriptionAtPeriodEndForConsole(user, params = {}, payload = {}) {
    await requirePermission(user, CONSOLE_BILLING_PERMISSIONS.OPERATIONS_MANAGE);
    if (!billingEnabled) {
      throw new AppError(404, "Not found.");
    }
    if (!billingRepository || typeof billingRepository.listSubscriptionsForConsole !== "function") {
      throw new AppError(501, "Console subscription operations are not available.");
    }

    const providerSubscriptionId = normalizeOptionalString(params?.providerSubscriptionId);
    if (!providerSubscriptionId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            providerSubscriptionId: "providerSubscriptionId is required."
          }
        }
      });
    }

    const body = normalizeObject(payload);
    const providerHint = normalizeOptionalString(body.provider) || null;
    const subscriptions = await billingRepository.listSubscriptionsForConsole({
      provider: providerHint,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const currentSubscription = mapSubscriptionToConsole(Array.isArray(subscriptions) ? subscriptions[0] : null);
    if (!currentSubscription) {
      throw createConsoleSubscriptionError(404, "Subscription not found.", "SUBSCRIPTION_NOT_FOUND", {
        providerSubscriptionId
      });
    }

    if (!billingProviderAdapter) {
      throw createConsoleSubscriptionError(
        501,
        "Provider subscription cancellation operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          providerSubscriptionId
        }
      );
    }

    const runSetCancelAtPeriodEnd =
      typeof billingProviderAdapter.setSubscriptionCancelAtPeriodEnd === "function"
        ? (subscriptionId) =>
            billingProviderAdapter.setSubscriptionCancelAtPeriodEnd({
              subscriptionId,
              cancelAtPeriodEnd: true
            })
        : typeof billingProviderAdapter.cancelSubscription === "function"
          ? (subscriptionId) =>
              billingProviderAdapter.cancelSubscription({
                subscriptionId,
                cancelAtPeriodEnd: true
              })
          : null;

    if (!runSetCancelAtPeriodEnd) {
      throw createConsoleSubscriptionError(
        501,
        "Provider subscription cancellation operation is not supported.",
        "PROVIDER_OPERATION_NOT_SUPPORTED",
        {
          providerSubscriptionId
        }
      );
    }

    let providerSubscription = null;
    try {
      providerSubscription = await runSetCancelAtPeriodEnd(providerSubscriptionId);
    } catch (error) {
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const errorCode = normalizeOptionalString(error?.code || error?.details?.code).toUpperCase();
      if (statusCode === 501 || errorCode === "PROVIDER_OPERATION_NOT_SUPPORTED") {
        throw createConsoleSubscriptionError(
          501,
          "Provider cancellation-at-period-end operation is not supported.",
          "PROVIDER_OPERATION_NOT_SUPPORTED",
          {
            providerSubscriptionId
          }
        );
      }

      throw createConsoleSubscriptionError(
        409,
        "Subscription cancel-at-period-end operation failed.",
        "BILLING_DEPENDENCY_CONFLICT",
        {
          providerSubscriptionId
        }
      );
    }

    const assignmentId = normalizePositiveInteger(currentSubscription.assignmentId);
    const providerStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status || currentSubscription.status);
    const providerCreatedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.created) ||
      normalizeOptionalDateTime(currentSubscription.providerSubscriptionCreatedAt) ||
      new Date();
    const providerCurrentPeriodEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.current_period_end) ||
      normalizeOptionalDateTime(currentSubscription.currentPeriodEnd) ||
      null;
    const providerTrialEnd =
      parseUnixEpochSecondsToDate(providerSubscription?.trial_end) || normalizeOptionalDateTime(currentSubscription.trialEnd) || null;
    const providerCanceledAt =
      parseUnixEpochSecondsToDate(providerSubscription?.canceled_at) ||
      normalizeOptionalDateTime(currentSubscription.canceledAt) ||
      null;
    const providerEndedAt =
      parseUnixEpochSecondsToDate(providerSubscription?.ended_at) || normalizeOptionalDateTime(currentSubscription.endedAt) || null;
    const providerCustomerId =
      resolveProviderObjectId(providerSubscription?.customer) || currentSubscription.providerCustomerId || null;

    if (assignmentId && typeof billingRepository.upsertPlanAssignmentProviderDetails === "function") {
      await billingRepository.upsertPlanAssignmentProviderDetails({
        billingPlanAssignmentId: assignmentId,
        provider: currentSubscription.provider,
        providerSubscriptionId,
        providerCustomerId,
        providerStatus,
        providerSubscriptionCreatedAt: providerCreatedAt,
        currentPeriodEnd: providerCurrentPeriodEnd,
        trialEnd: providerTrialEnd,
        canceledAt: providerCanceledAt,
        cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end ?? true),
        endedAt: providerEndedAt,
        lastProviderEventCreatedAt: new Date(),
        lastProviderEventId: null,
        metadataJson:
          providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
            ? providerSubscription.metadata
            : currentSubscription.metadataJson || {}
      });
    }

    const refreshedRows = await billingRepository.listSubscriptionsForConsole({
      provider: currentSubscription.provider,
      providerSubscriptionId,
      limit: 1,
      offset: 0
    });
    const refreshedSubscription = mapSubscriptionToConsole(Array.isArray(refreshedRows) ? refreshedRows[0] : null);
    return {
      subscription: refreshedSubscription || currentSubscription
    };
  }

  return {
    getBillingSettings,
    updateBillingSettings,
    listBillingEvents,
    listBillingPlans,
    listBillingProducts,
    createBillingPlan,
    createBillingProduct,
    listBillingProviderPrices,
    updateBillingPlan,
    updateBillingProduct,
    listEntitlementDefinitions,
    getEntitlementDefinition,
    createEntitlementDefinition,
    updateEntitlementDefinition,
    deleteEntitlementDefinition,
    archiveBillingPlan,
    unarchiveBillingPlan,
    deleteBillingPlan,
    archiveBillingProduct,
    unarchiveBillingProduct,
    deleteBillingProduct,
    listPurchasesForConsole,
    refundPurchaseForConsole,
    voidPurchaseForConsole,
    createPurchaseCorrectionForConsole,
    listPlanAssignmentsForConsole,
    createPlanAssignmentForConsole,
    updatePlanAssignmentForConsole,
    cancelPlanAssignmentForConsole,
    listSubscriptionsForConsole,
    changeSubscriptionPlanForConsole,
    cancelSubscriptionForConsole,
    cancelSubscriptionAtPeriodEndForConsole
  };
}

export { createConsoleBillingService };
