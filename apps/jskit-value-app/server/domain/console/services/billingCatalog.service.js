import { createBillingCatalogCore } from "@jskit-ai/billing-core/catalogCore";
import { AppError } from "../../../lib/errors.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { assertEntitlementValueOrThrow } from "../../../lib/billing/entitlementSchemaRegistry.js";

const billingCatalogCore = createBillingCatalogCore({
  createError(status, message, options = {}) {
    return new AppError(status, message, options);
  },
  parsePositiveInteger,
  isDuplicateEntryError: isMysqlDuplicateEntryError,
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
