import { createBillingCatalogCore } from "@jskit-ai/billing-core/catalogCore";
import { assertEntitlementValueOrThrow } from "@jskit-ai/billing-core/entitlementSchema";
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { isDuplicateEntryError } from "@jskit-ai/jskit-knex/errors";

const billingCatalogCore = createBillingCatalogCore({
  createError(status, message, options = {}) {
    return new AppError(status, message, options);
  },
  parsePositiveInteger,
  isDuplicateEntryError: isDuplicateEntryError,
  assertEntitlementValueOrThrow
});

const {
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
} = billingCatalogCore;

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
