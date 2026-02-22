# Billing Contracts and Integration Docs

This directory is the canonical entry point for billing implementation contracts and app-integration guidance.

Use these files first before changing billing behavior:

- `docs/billing/contracts.md`
- `docs/billing/integration-guide.md`
- `docs/billing/provider-insulation-contract.md`

Supporting source-of-truth implementation files:

- `server/modules/billing/routes.js`
- `server/modules/billing/schema.js`
- `server/modules/billing/service.js`
- `server/modules/billing/policy.service.js`
- `server/modules/billing/idempotency.service.js`
- `server/modules/billing/constants.js`

Plan and matrix context:

- `STRIPE_PLAN.md`
- `STRIPE_PLAN_MATRIX.md`

Contract-lock tests:

- `tests/billingPhase21Service.test.js`
- `tests/billingPolicyServiceEntityScope.test.js`
- `tests/billingIdempotencyService.test.js`
- `tests/billingErrorCodeContract.test.js`
- `tests/billingPlanChangeService.test.js`
- `tests/billingRoutesPolicy.test.js`
