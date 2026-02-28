# @jskit-ai/billing-core

Shared billing catalog domain logic for plans, products, entitlement templates, and provider price checks.

## What this package is for

Use this package to keep billing catalog rules centralized and testable:

- validate and normalize create/update payloads for plans and products
- map entitlement payloads to repository template rows and back
- map duplicate database errors to user-safe API errors
- delegate provider price normalization to the active billing provider adapter
- assert repository shape before running catalog operations

This package is pure business logic. It is designed to be called from app services.

## What this package is not for

- No HTTP route/controller code.
- No direct database queries.
- No provider SDK setup.
- No UI.

## Exports

- `@jskit-ai/billing-core`
- `@jskit-ai/billing-core/catalogCore`
- `@jskit-ai/billing-core/providerPricingCore`
- `@jskit-ai/billing-core/entitlementSchema`

## Main entry points

### `createBillingCatalogCore(dependencies?)`

Factory that returns plan and product catalog business functions. Dependency injection lets each app plug in its own:

- `createError`
- `parsePositiveInteger`
- `isDuplicateEntryError`
- `assertEntitlementValueOrThrow`

Real-life example:

- In `jskit-value-app`, the service injects `AppError`, mysql duplicate detection, and entitlement schema validation so errors and schema behavior match app standards.

### `createBillingCatalogProviderPricingCore(dependencies?)`

Factory for provider pricing normalization helpers, with injectable `createError`.

Real-life example:

- Before accepting a submitted provider price id, the app delegates validation to the active provider adapter.

### `entitlementSchema`

Shared entitlement payload schema validation helpers:

- `resolveSchemaValidator(schemaVersion)`
- `validateEntitlementValue({ schemaVersion, value })`
- `assertEntitlementValueOrThrow({ schemaVersion, value, errorStatus })`

Real-life example:

- `jskit-value-app` uses `assertEntitlementValueOrThrow` in console billing catalog service to reject malformed entitlement values before persistence.

## `catalogCore` returned API (function by function)

The object returned by `createBillingCatalogCore` includes:

- `DEFAULT_BILLING_PROVIDER`
  - Current default provider id (`stripe`).
  - Example: if config is missing, catalog code still resolves provider consistently.
- `resolveBillingProvider(value)`
  - Normalizes provider value and falls back to default.
  - Example: admin payload omits provider, system resolves to `stripe`.
- `normalizeBillingCatalogPlanCreatePayload(payload, { activeBillingProvider })`
  - Validates and normalizes plan create payload.
  - Example: checks plan code/name/core price and entitlement shape before insert.
- `normalizeBillingCatalogPlanUpdatePayload(payload, { activeBillingProvider })`
  - Validates plan update patch; requires at least one meaningful field.
  - Example: rejects empty PATCH body instead of silently doing nothing.
- `normalizeBillingCatalogProductCreatePayload(payload, { activeBillingProvider })`
  - Validates and normalizes product create payload.
  - Example: enforces one-time price shape for product catalog entries.
- `normalizeBillingCatalogProductUpdatePayload(payload, { activeBillingProvider })`
  - Validates product update patch and optional entitlement replacement payload.
  - Example: allows updating only `name` while leaving price untouched.
- `mapPlanEntitlementsToTemplates(entitlements, definitionByCode)`
  - Maps API entitlement entries to repository plan template rows.
  - Example: converts entitlement code `ai.tokens.monthly` into a concrete `entitlementDefinitionId`.
- `mapProductEntitlementsToTemplates(entitlements, definitionByCode)`
  - Maps product entitlement entries to repository product template rows.
  - Example: turns top-up payload into template rows tied to definition ids.
- `mapPlanTemplatesToConsoleEntitlements(templates, definitionById)`
  - Maps repository rows back to console-friendly entitlement payload.
  - Example: list endpoint can return readable entitlement codes instead of internal ids.
- `mapProductTemplatesToConsoleEntitlements(templates, definitionById)`
  - Same as above for product templates.
  - Example: product catalog list response returns readable entitlement codes for each one-off product.
- `mapBillingPlanDuplicateError(error)`
  - Converts duplicate DB errors to specific 409 conflicts for plans.
  - Example: duplicate plan code becomes `Billing plan code already exists.`.
- `mapBillingProductDuplicateError(error)`
  - Converts duplicate DB errors to specific 409 conflicts for products.
  - Example: duplicate provider price mapping returns conflict with clear message.
- `ensureBillingCatalogRepository(billingRepository)`
  - Asserts required plan-catalog repository methods exist.
  - Example: throws 501 if a deployment forgot to wire catalog repo methods.
- `ensureBillingProductCatalogRepository(billingRepository)`
  - Asserts required product-catalog repository methods exist.
  - Example: prevents runtime crash halfway through product operations.
- `buildConsoleBillingPlanCatalog({ billingRepository, activeBillingProvider })`
  - Loads plans + entitlement templates and assembles console response model.
  - Example: admin billing screen needs plans with full entitlement details.
- `buildConsoleBillingProductCatalog({ billingRepository, activeBillingProvider })`
  - Loads products + entitlement templates and assembles console response model.
  - Example: admin screen lists available one-off products and included grants.

## `providerPricingCore` returned API (function by function)

The object returned by `createBillingCatalogProviderPricingCore` includes:
- `resolveCatalogCorePriceForCreate({ activeBillingProvider, billingProviderAdapter, corePrice })`
  - Delegates create-time core price normalization to `billingProviderAdapter.resolveCatalogCorePriceForCreate`.
  - Example: keeps provider-specific checks out of billing core logic.
- `resolveCatalogCorePriceForUpdate({ activeBillingProvider, billingProviderAdapter, corePrice })`
  - Same as above for update payloads.
- `resolveCatalogProductPriceForCreate({ activeBillingProvider, billingProviderAdapter, price })`
  - Delegates product create price normalization to `billingProviderAdapter.resolveCatalogProductPriceForCreate`.
- `resolveCatalogProductPriceForUpdate({ activeBillingProvider, billingProviderAdapter, price })`
  - Delegates product update price normalization to `billingProviderAdapter.resolveCatalogProductPriceForUpdate`.

## How it is used in apps (real terms, and why)

Current `jskit-value-app` usage:

- `apps/jskit-value-app/server/domain/console/services/billingCatalog.service.js`
  - creates a `billingCatalogCore` instance
  - injects `AppError`, mysql duplicate checks, and entitlement schema validation
  - re-exports normalized domain methods to service layer
- `apps/jskit-value-app/server/domain/console/services/billingCatalogProviderPricing.service.js`
  - creates `billingCatalogProviderPricingCore`
  - injects `AppError`
  - re-exports provider pricing verification helpers

Why this matters:

- keeps billing behavior deterministic across endpoints
- avoids duplicate validation logic in multiple services/controllers
- makes provider checks explicit and testable

Practical create-plan flow:

1. API payload hits service.
2. `normalizeBillingCatalogPlanCreatePayload` validates structure and entitlement rules.
3. `resolveCatalogCorePriceForCreate` delegates provider-specific price normalization to the active provider adapter.
4. `mapPlanEntitlementsToTemplates` converts external codes to repository template rows.
5. Repository persists rows inside transaction.
