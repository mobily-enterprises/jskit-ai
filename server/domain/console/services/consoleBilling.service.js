import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { normalizePagination } from "../../../lib/primitives/pagination.js";
import { CONSOLE_BILLING_PERMISSIONS } from "../policies/roles.js";
import {
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
    return buildConsoleBillingPlanCatalog({
      billingRepository,
      activeBillingProvider
    });
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
        const plan = await billingRepository.createPlan(
          {
            ...normalized.plan,
            corePrice: resolvedCorePrice
          },
          { trx }
        );

        for (const entitlement of normalized.entitlements) {
          await billingRepository.upsertPlanEntitlement(
            {
              planId: plan.id,
              code: entitlement.code,
              schemaVersion: entitlement.schemaVersion,
              valueJson: entitlement.valueJson
            },
            { trx }
          );
        }

        const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id, { trx });
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
      const createdProduct = await billingRepository.transaction(async (trx) =>
        billingRepository.createProduct(
          {
            ...normalized.product,
            price: resolvedPrice
          },
          { trx }
        )
      );

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

    const normalizedPatch = normalizeBillingCatalogPlanUpdatePayload(payload, {
      activeBillingProvider
    });
    const resolvedCorePrice = normalizedPatch.corePrice
      ? await resolveCatalogCorePriceForUpdate({
          activeBillingProvider,
          billingProviderAdapter,
          corePrice: normalizedPatch.corePrice
        })
      : null;

    try {
      const updatedPlan = await billingRepository.transaction(async (trx) => {
        const plan = await billingRepository.findPlanById(planId, { trx });
        if (!plan) {
          throw new AppError(404, "Billing plan not found.");
        }

        const updatePatch = {
          ...normalizedPatch
        };
        if (resolvedCorePrice) {
          updatePatch.corePrice = resolvedCorePrice;
        }

        const nextPlan = await billingRepository.updatePlanById(plan.id, updatePatch, { trx });
        const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id, { trx });
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

    const normalizedPatch = normalizeBillingCatalogProductUpdatePayload(payload, {
      activeBillingProvider
    });
    const resolvedPrice = normalizedPatch.price
      ? await resolveCatalogProductPriceForUpdate({
          activeBillingProvider,
          billingProviderAdapter,
          price: normalizedPatch.price
        })
      : null;

    try {
      const updatedProduct = await billingRepository.transaction(async (trx) => {
        const product = await billingRepository.findProductById(productId, { trx });
        if (!product) {
          throw new AppError(404, "Billing product not found.");
        }

        const updatePatch = {
          ...normalizedPatch
        };
        if (resolvedPrice) {
          updatePatch.price = resolvedPrice;
        }

        return billingRepository.updateProductById(product.id, updatePatch, { trx });
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
    updateBillingProduct
  };
}

export { createConsoleBillingService };
