# Billing Contract Reference

Last updated: 2026-02-25

This document freezes current billing contracts for:

- limitations API shape
- billable-entity selector and authorization behavior
- idempotency and billing failure code behavior
- workspace core-plan state/change behavior (immediate upgrades, scheduled downgrades)

Primary implementation references:

- `packages/billing/billing-fastify-adapter/src/routes.js`
- `packages/billing/billing-fastify-adapter/src/schema.js`
- `packages/billing/billing-service-core/src/service.js`
- `packages/billing/billing-service-core/src/policy.service.js`
- `packages/billing/billing-service-core/src/idempotency.service.js`
- `packages/billing/billing-service-core/src/constants.js`
- `packages/billing/billing-service-core/src/appCapabilityLimits.js`

## 1. Billable-Entity Selection and Auth Contract

Billing routes use `workspacePolicy: "optional"` and perform authz in billing policy service.

Selector precedence:

1. `x-billable-entity-id` header
2. route param `billableEntityId`
3. query `billableEntityId`

If no billable-entity selector is provided, workspace selector precedence is:

1. `x-workspace-slug` header
2. route param `workspaceSlug`
3. query `workspaceSlug`

### Read resolution (`resolveBillableEntityForReadRequest`)

- If a billable-entity selector is present:
  - `workspace` entity type: caller must belong to the mapped workspace.
  - `user` entity type: caller `user.id` must equal entity `ownerUserId`.
  - `organization` or `external` entity types: currently forbidden.
- If selector is absent:
  - with explicit workspace selector (`x-workspace-slug`/param/query): resolve workspace-scoped entity.
  - without workspace selector: resolve owner-scoped user entity (`entityType=user`, `entityRef=user:{id}`).

### Write resolution (`resolveBillableEntityForWriteRequest`)

- If a billable-entity selector is present:
  - `workspace` entity type: same membership checks plus `workspace.billing.manage` permission.
  - `user` entity type: owner-only (no workspace role check).
  - `organization` or `external` entity types: currently forbidden.
- If selector is absent:
  - with explicit workspace selector (`x-workspace-slug`/param/query): resolve workspace-scoped entity and enforce `workspace.billing.manage`.
  - without workspace selector: resolve owner-scoped user entity (`entityType=user`, `entityRef=user:{id}`).

## 2. Limitations API Contract

Endpoint:

- `GET /api/v1/billing/limitations`

Response shape:

```json
{
  "billableEntity": {
    "id": 7,
    "entityType": "workspace",
    "entityRef": null,
    "workspaceId": 10,
    "ownerUserId": 1,
    "status": "active",
    "createdAt": "2026-02-21T00:00:00.000Z",
    "updatedAt": "2026-02-21T00:00:00.000Z"
  },
  "generatedAt": "2026-02-21T12:34:56.000Z",
  "stale": false,
  "limitations": [
    {
      "code": "deg2rad.calculations.monthly",
      "entitlementType": "metered_quota",
      "enforcementMode": "hard_deny",
      "unit": "calculation",
      "windowInterval": "month",
      "windowAnchor": "calendar_utc",
      "grantedAmount": 1000,
      "consumedAmount": 120,
      "effectiveAmount": 880,
      "hardLimitAmount": 1000,
      "overLimit": false,
      "lockState": "none",
      "nextChangeAt": "2026-03-01T00:00:00.000Z",
      "windowStartAt": "2026-02-01T00:00:00.000Z",
      "windowEndAt": "2026-03-01T00:00:00.000Z",
      "lastRecomputedAt": "2026-02-21T12:34:56.000Z"
    }
  ]
}
```

Runtime enforcement kernel contract (`billingService.executeWithEntitlementConsumption`):

- Inputs:
  - request context (`request`, `user`) for billable-entity resolution.
  - `capability` and/or explicit `limitationCode`.
  - `amount` (usage amount, default from capability config or `1`).
  - `usageEventKey` (optional dedupe key for retry-safe consumption writes).
  - `action` callback (the business operation to execute).
- Capability mapping source:
  - `packages/billing/billing-service-core/src/appCapabilityLimits.js`
- Behavior:
  - resolves billable entity through billing policy.
  - freshens projection-backed limitation balances.
  - enforces capacity/quota/balance constraints before executing `action`.
  - executes `action` and consumption write in one transaction.
  - for metered/balance types, writes idempotent rows in `billing_entitlement_consumptions`.
  - for capacity types, recomputes with domain-provided count resolver (no consumption row in scaffold v1).
  - emits billing-limit realtime invalidation after commit.

Deterministic limit-exceeded error contract:

- HTTP status: `429`
- code: `BILLING_LIMIT_EXCEEDED`
- details fields:
  - `limitationCode`
  - `billableEntityId`
  - `reason`
  - `requestedAmount`, `limit`, `used`, `remaining`
  - `interval`, `enforcement`
  - `windowEndAt`, `retryAfterSeconds`

## 3. Idempotency and Error-Code Contract

Checkout request contract (subscription flow):

```json
{
  "planCode": "pro_monthly",
  "successPath": "/billing?checkout=success",
  "cancelPath": "/billing?checkout=cancel"
}
```

Notes:

- Core subscription checkout resolves exactly one recurring Stripe price from the selected plan mapping.
- Core subscription checkout does not accept component selection.
- Extras (credits, setup fees, premium support) are sold through separate payment-link flows.

Routes requiring `Idempotency-Key` request header:

- `POST /api/v1/billing/checkout`
- `POST /api/v1/billing/portal`
- `POST /api/v1/billing/payment-links`

Missing header behavior:

- HTTP `400`
- message: `Idempotency-Key header is required.`

Idempotency conflict behavior:

- Same tuple `(billable_entity_id, action, client_idempotency_key)` with a different request fingerprint returns HTTP `409`.
- Failure code: `idempotency_conflict`.

Canonical billing failure codes (`BILLING_FAILURE_CODES`):

- `request_in_progress`
- `checkout_in_progress`
- `checkout_session_open`
- `checkout_completion_pending`
- `checkout_recovery_verification_pending`
- `checkout_plan_not_found`
- `checkout_configuration_invalid`
- `subscription_exists_use_portal`
- `portal_subscription_required`
- `checkout_recovery_window_elapsed`
- `checkout_replay_provenance_mismatch`
- `checkout_provider_error`
- `idempotency_conflict`

Failure code to HTTP status mapping (`statusFromFailureCode`):

- `checkout_provider_error` -> `502`
- `checkout_plan_not_found` -> `404`
- all other billing failure codes -> `409`

Error envelope:

- standard API error body includes `error`.
- billing service failures include machine-readable code at `details.code`.
- validation failures include `fieldErrors` and `details.fieldErrors`.

## 4. Plan-State and Plan-Change Contract

Endpoints:

- `GET /api/v1/billing/plan-state`
- `POST /api/v1/billing/plan-change`
- `POST /api/v1/billing/plan-change/cancel`

`GET /api/v1/billing/plan-state` response guarantees:

- `currentPlan`: active plan currently applied to the entity (or `null`).
- `nextPlanChange`: pending scheduled change (or `null`).
- `availablePlans`: active plans excluding `currentPlan`.
- `history`: effective changes only (no pending-only records).
- `settings.paidPlanChangePaymentMethodPolicy`: one of:
  - `required_now`
  - `allow_without_payment_method`

`POST /api/v1/billing/plan-change` request body:

```json
{
  "planCode": "pro_monthly",
  "successPath": "/billing?checkout=success",
  "cancelPath": "/billing?checkout=cancel"
}
```

Behavior contract:

- Upgrades apply immediately (`mode: "applied"`).
- Downgrades schedule at the current period end (`mode: "scheduled"`).
- Selecting the current plan is a no-op (`mode: "unchanged"`).
- If no active subscription exists and target is paid, response can require checkout (`mode: "checkout_required"` + `checkout` payload).
- Free-plan moves do not require Stripe checkout and apply directly.

`POST /api/v1/billing/plan-change/cancel` behavior:

- Cancels only a pending scheduled change.
- Returns `{ "canceled": true|false, "state": ... }`.

## 5. Console Purchase Operations Contract

Console purchase operations are global-surface admin endpoints and are separate from workspace self-service billing routes.

Endpoints:

- `GET /api/v1/console/billing/purchases`
- `POST /api/v1/console/billing/purchases/:purchaseId/refund`
- `POST /api/v1/console/billing/purchases/:purchaseId/void`
- `POST /api/v1/console/billing/purchases/:purchaseId/corrections`

Idempotency contract:

- `Idempotency-Key` is required for all purchase mutation endpoints (`refund`, `void`, `corrections`).
- Missing key returns HTTP `400` with code `IDEMPOTENCY_KEY_REQUIRED`.
- Durable replay source is `billing_purchase_adjustments.request_idempotency_key`.
- Reusing an idempotency key for a different purchase or different action returns HTTP `409` with `PURCHASE_ADJUSTMENT_DUPLICATE`.

Mutation response contract:

- All purchase mutation endpoints return:
  - `purchase`: current purchase projection (or `null` in replay edge cases).
  - `adjustment`: the adjustment row matching the command/replay.
  - `adjustments`: recent adjustment history for the purchase (newest first).

Adjustment audit contract:

- Every attempted purchase mutation writes an adjustment row with outcome status:
  - `succeeded`
  - `failed`
  - `noop`
  - `recorded` (manual correction recorded without provider mutation)

Deterministic error codes:

- `PURCHASE_NOT_FOUND` -> HTTP `404`
- `PURCHASE_REFUND_NOT_ALLOWED` -> HTTP `409`
- `PURCHASE_VOID_NOT_ALLOWED` -> HTTP `409`
- `PURCHASE_ADJUSTMENT_DUPLICATE` -> HTTP `409`
- `PROVIDER_OPERATION_NOT_SUPPORTED` -> HTTP `501`

As with other billing routes, machine-readable error code is available at `details.code`.

## 6. Console Assignment and Subscription Admin Contract

Console assignment/subscription admin endpoints are global-surface operations and are separate from workspace self-service billing flows.

Plan assignment endpoints:

- `GET /api/v1/console/billing/plan-assignments`
- `POST /api/v1/console/billing/plan-assignments`
- `PATCH /api/v1/console/billing/plan-assignments/:assignmentId`
- `POST /api/v1/console/billing/plan-assignments/:assignmentId/cancel`

Subscription endpoints:

- `GET /api/v1/console/billing/subscriptions`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/change-plan`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel`
- `POST /api/v1/console/billing/subscriptions/:providerSubscriptionId/cancel-at-period-end`

Idempotency contract:

- `Idempotency-Key` is required for all assignment and subscription mutation endpoints listed above.
- Missing key returns HTTP `400` with code `IDEMPOTENCY_KEY_REQUIRED`.

Response contract:

- Plan assignment mutations return `{ "assignment": ... }`.
- Subscription mutations return `{ "subscription": ... }`.
- List endpoints return paginated envelopes with `entries`, `page`, `pageSize`, and `hasMore`.

Deterministic error codes:

- `PLAN_ASSIGNMENT_NOT_FOUND` -> HTTP `404`
- `SUBSCRIPTION_NOT_FOUND` -> HTTP `404`
- `PROVIDER_OPERATION_NOT_SUPPORTED` -> HTTP `501`
- `BILLING_DEPENDENCY_CONFLICT` -> HTTP `409`

## 7. Workspace Payment-Method Mutation Contract

Workspace billing payment-method endpoints:

- `POST /api/v1/billing/payment-methods/:paymentMethodId/default`
- `POST /api/v1/billing/payment-methods/:paymentMethodId/detach`
- `DELETE /api/v1/billing/payment-methods/:paymentMethodId`

Idempotency contract:

- `Idempotency-Key` is required for all three mutation endpoints.
- Missing key returns HTTP `400` with code `IDEMPOTENCY_KEY_REQUIRED`.

Deterministic error codes:

- `PAYMENT_METHOD_NOT_FOUND` -> HTTP `404`
- `PAYMENT_METHOD_NOT_OWNED_BY_ENTITY` -> HTTP `409`
- `PAYMENT_METHOD_PROVIDER_UNSUPPORTED` -> HTTP `501`
- `PROVIDER_OPERATION_NOT_SUPPORTED` -> HTTP `501`

## 8. Assistant Tool Contract and Surface Limitation

New billing actions in console/workspace contributors include `assistant_tool` channel metadata with explicit `assistantTool.description` and strict `assistantTool.inputJsonSchema`.

Current transport limitation:

- Assistant HTTP endpoints are currently workspace-scoped (`/api/workspace/ai/*`).
- Console-surface billing tools are available to internal/non-HTTP assistant contexts, but are not currently reachable through a dedicated console assistant HTTP transport.
