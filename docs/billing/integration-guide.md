# Billing Integration Guide

Last updated: 2026-02-21

This guide defines how app features should integrate billing limitations and usage accounting.

Primary references:

- `server/modules/billing/service.js`
- `src/services/api/billingApi.js`
- `src/views/workspace-billing/useWorkspaceBillingView.js`
- `STRIPE_PLAN.md`
- `STRIPE_PLAN_MATRIX.md`

## 1. Where Features Must Call `getLimitations`

Use `GET /api/billing/limitations` as the app-facing source of truth for entitlement and quota state.

Required call points:

1. At workspace/app bootstrap after auth context is ready.
2. When opening feature screens gated by plan or quota.
3. Immediately before hard-limited actions that can spend quota.
4. After billing mutations (checkout completion, plan changes, one-off purchases) to refresh state.

Client API entry point:

- `api.billing.getLimitations()` in `src/services/api/billingApi.js`

## 2. Where Usage Counters Must Be Incremented

Usage counters are server-side only. Do not trust client-side increments.

Service API:

- `billingService.recordUsage({ billableEntityId, entitlementCode, amount, now, metadataJson })`

Integration rules for feature services:

1. Resolve billable entity in request context first.
2. Execute the feature operation.
3. Increment usage for each consumed quota entitlement.
4. Return quota-aware response state or refetch limitations.

Recommended placement:

- increment in the same backend flow that persists the billable action.
- for batch operations, pass the aggregate `amount`.
- include metadata useful for audits (`metadataJson`).

## 3. Expected Fail-Closed Behavior

When billing state is uncertain, deny the action instead of allowing overuse.

Required fail-closed outcomes:

1. Cannot resolve billable entity or auth scope -> return `403`/`409`, do not continue.
2. Cannot fetch or compute limitations for a gated feature -> block feature action.
3. Missing subscription for quota accounting -> block usage accounting (`409`).
4. Missing entitlement or non-quota entitlement passed to usage accounting -> reject (`404`/`409`).
5. Usage counter storage unavailable -> reject (`500`), do not silently continue.
6. Billing write idempotency row is active or provider outcome indeterminate -> return `request_in_progress` (`409`) and require retry/poll UX.

## 4. Integration Checklist for New Features

1. Map feature actions to entitlement codes.
2. Add preflight `getLimitations` checks in client and backend guard points.
3. Add server-side `recordUsage` on successful billable actions.
4. Wire fail-closed responses for unavailable/uncertain billing state.
5. Add tests that lock this behavior.

## 5. Contract-Lock Tests

Keep these tests passing and extend them when behavior changes:

- `tests/billingPhase21Service.test.js`
- `tests/billingPolicyServiceEntityScope.test.js`
- `tests/billingIdempotencyService.test.js`
- `tests/billingErrorCodeContract.test.js`
