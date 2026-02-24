# Billing Contracts and Integration Docs

Last validated: 2026-02-24 (UTC)

This directory is the canonical entry point for billing implementation contracts and app-integration guidance.

Use these files first before changing billing behavior:

- `docs/billing/contracts.md`
- `docs/billing/integration-guide.md`
- `docs/billing/provider-insulation-contract.md`

Supporting source-of-truth implementation files:

- `packages/billing/billing-fastify-adapter/src/routes.js`
- `packages/billing/billing-fastify-adapter/src/schema.js`
- `packages/billing/billing-service-core/src/service.js`
- `packages/billing/billing-service-core/src/policy.service.js`
- `packages/billing/billing-service-core/src/idempotency.service.js`
- `packages/billing/billing-service-core/src/constants.js`
- `apps/jskit-value-app/server/runtime/services.js`

Plan/catalog context:

- `packages/billing/billing-core/src/catalogCore.js`
- `packages/billing/billing-service-core/src/pricing.service.js`
- `docs/db/BILLABLE_DATA_TABLES.md`

Contract-lock tests:

- `apps/jskit-value-app/tests/billingPhase21Service.test.js`
- `apps/jskit-value-app/tests/billingPolicyServiceEntityScope.test.js`
- `apps/jskit-value-app/tests/billingIdempotencyService.test.js`
- `apps/jskit-value-app/tests/billingErrorCodeContract.test.js`
- `apps/jskit-value-app/tests/billingPlanChangeService.test.js`
- `apps/jskit-value-app/tests/billingRoutesPolicy.test.js`
