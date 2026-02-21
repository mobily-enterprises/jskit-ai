# Billing Contract Reference

Last updated: 2026-02-21

This document freezes current billing contracts for:

- limitations API shape
- billable-entity selector and authorization behavior
- idempotency and billing failure code behavior

Primary implementation references:

- `server/modules/billing/routes.js`
- `server/modules/billing/schema.js`
- `server/modules/billing/service.js`
- `server/modules/billing/policy.service.js`
- `server/modules/billing/idempotency.service.js`
- `server/modules/billing/constants.js`

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
  - single accessible workspace: auto-selected.
  - multiple accessible workspaces: `409` (`BILLING_WORKSPACE_SELECTION_REQUIRED`).
  - no accessible workspaces: `403` (`BILLING_WORKSPACE_FORBIDDEN`).

### Write resolution (`resolveBillableEntityForWriteRequest`)

- If a billable-entity selector is present:
  - `workspace` entity type: same membership checks plus `workspace.billing.manage` permission.
  - `user` entity type: owner-only (no workspace role check).
  - `organization` or `external` entity types: currently forbidden.
- If selector is absent:
  - explicit workspace selection is required when user can access more than one workspace.
  - workspace write permission is mandatory (`workspace.billing.manage`).

## 2. Limitations API Contract

Endpoint:

- `GET /api/billing/limitations`

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
  "subscription": null,
  "generatedAt": "2026-02-21T12:34:56.000Z",
  "limitations": [
    {
      "code": "api_calls",
      "schemaVersion": "entitlement.quota.v1",
      "type": "quota",
      "valueJson": { "limit": 1000, "interval": "month", "enforcement": "hard" },
      "quota": {
        "interval": "month",
        "enforcement": "hard",
        "limit": 1000,
        "used": 20,
        "remaining": 980,
        "reached": false,
        "exceeded": false,
        "windowStartAt": "2026-02-01T00:00:00.000Z",
        "windowEndAt": "2026-03-01T00:00:00.000Z"
      }
    }
  ]
}
```

Limitation derivation rules:

- `entitlement.boolean.v1` -> `type: "boolean"` + `enabled`
- `entitlement.string_list.v1` -> `type: "string_list"` + `values` (stringified)
- `entitlement.quota.v1` -> `type: "quota"` + `quota` object
- unknown or invalid entitlement payloads are fail-closed and reject `getLimitations` (current behavior: `500`, code `ENTITLEMENT_SCHEMA_INVALID`)

Quota window rules:

- allowed intervals in current entitlement schema: `day`, `week`, `month`, `year`
- windows are UTC-based
- allowed quota enforcement values: `hard`, `soft`

## 3. Idempotency and Error-Code Contract

Routes requiring `Idempotency-Key` request header:

- `POST /api/billing/checkout`
- `POST /api/billing/portal`
- `POST /api/billing/payment-links`

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
