# Consumable Entitlements - Coding Execution Prompt

Use this prompt in the next coding session to implement `consumable.md` end-to-end.

## 0) Mission

Implement the consumable entitlements engine described in `consumable.md` and wire it into the current codebase with minimal boilerplate and clean layering.

This is scaffolding-first:

- `projects` and annuity calculator limits are **examples only** to prove the architecture.
- The core engine must remain generic and reusable.
- Example integrations must be thin and easy to delete later.

Do not partially implement the architecture. Complete all critical plumbing paths so the scaffold demonstrates a real, working pattern.

## 1) Non-Negotiable Constraints

1. No compatibility shims or legacy re-exports.
2. No dead runtime paths left behind.
3. Preserve idempotency and webhook-confirmed grant semantics.
4. Do not grant business value from redirect/return URL.
5. Keep `billing_purchases` and `billing_events` roles separate.
6. Keep scaffold-specific logic out of core schema design.
7. Respect existing repo boundaries (routes/controller/service/repository).
8. Keep DB migration names/FK/index identifiers <= 64 chars (MySQL).
9. Preserve dirty unrelated worktree changes.
10. Do not use destructive git commands.

## 2) Source of Truth Files

Primary architecture spec:

- `consumable.md`

Current code surfaces to align:

- `server/modules/billing/repository.js`
- `server/modules/billing/service.js`
- `server/modules/billing/schema.js`
- `server/modules/billing/routes.js`
- `server/modules/billing/controller.js`
- `server/modules/billing/workerRuntime.service.js`
- `server/modules/billing/webhookSubscriptionProjection.service.js`
- `server/modules/billing/purchaseLedgerProjection.utils.js`
- `server/modules/billing/appCapabilityLimits.js`
- `server/modules/projects/controller.js`
- `server/modules/projects/service.js`
- `server/modules/projects/repository.js`
- `server/modules/projects/schema.js`
- `server/modules/annuity/controller.js`
- `server/modules/history/service.js`
- `server/modules/history/repository.js`
- `server/runtime/controllers.js`
- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `shared/realtime/eventTypes.js`
- `shared/realtime/topicRegistry.js`
- `src/services/realtime/realtimeEventHandlers.js`
- `src/features/workspaceAdmin/queryKeys.js`
- `src/views/workspace-billing/useWorkspaceBillingView.js`
- `src/views/console/useConsoleBillingPlansView.js`
- `src/views/console/ConsoleBillingPlansView.vue`
- `src/views/console/useConsoleBillingProductsView.js`
- `src/views/console/ConsoleBillingProductsView.vue`

## 3) Deliverables (must all be done)

1. DB schema + one-way migrations for entitlement engine tables.
2. Deterministic backfill/bootstrap for definitions/templates/grants/balances.
3. Removal of current limitation stubs from runtime paths.
4. Production-ready repository/service implementation for grants, consumptions, balances.
5. Transactional wrapper `executeWithEntitlementConsumption(...)`.
6. Plan/product JSON authoring at console edge -> typed template persistence.
7. Purchase-confirmed webhook grant projection.
8. Plan state transition grant projection.
9. Worker boundary tick using `next_change_at`.
10. Realtime topic + client invalidation integration.
11. Scaffold integration:
    - projects capacity checks (create + archived->active transitions)
    - annuity metered consumption with shared transaction
12. Updated API contract for `GET /api/billing/limitations`.
13. Tests (migration/repository/service/worker/realtime/contract).
14. Docs updates reflecting final behavior and scaffold status.

## 4) Execution Plan (strict order)

## Phase 0 - Preflight and Safety

1. Re-read `consumable.md` fully.
2. Capture current grep snapshot for stubs and integration points:
   - `listPlanEntitlementsForPlan`
   - `incrementUsageCounter`
   - `claimUsageEvent`
   - `enforceLimitAndRecordUsage`
3. Capture baseline query-key/realtime topic snapshot:
   - `REALTIME_TOPICS`
   - `workspaceBilling...QueryKey`
4. Confirm current console plan/product schemas and service payload handling.
5. Confirm annuity + history + projects call graphs.

Success gate:

- You can list exactly which stubs will be deleted/replaced and where each new path will live.

## Phase 1 - DB Schema and Migrations

Create one-way migrations implementing `consumable.md` table model:

1. `billing_entitlement_definitions`
2. `billing_plan_entitlement_templates`
3. `billing_product_entitlement_templates`
4. `billing_entitlement_grants`
5. `billing_entitlement_consumptions`
6. `billing_entitlement_balances`
7. Optional (phase-1 optional but recommended): `billing_resource_snapshots`

Requirements:

- Explicit FK/index/constraint names <= 64 chars.
- Correct unique keys and checks.
- Add timestamps consistently.
- Add required indexes for read and worker paths.
- Irreversible down migration (throw loudly / no-op with explicit message).

Backfill/bootstrap migration requirements:

1. Seed `billing_entitlement_definitions` with scaffold definitions:
   - `projects.max`
   - `annuity.calculations.monthly`
   - optionally `workspace.access` if implementing now
2. Backfill typed plan templates from existing plan entitlement JSON data.
3. Backfill typed product templates from existing product entitlement JSON data when present.
4. Apply deterministic product classifier from `consumable.md`:
   - template exists, or payload/source entitlements array exists, or migration metadata entitlements exists.
5. Fail migration if:
   - unknown definition code
   - ambiguous/untransformable amount
   - invalid windows
   - entitlement-granting product ends with zero template rows

Success gate:

- Migration runs clean from empty DB and from current live-like DB.
- Migration fails loudly on seeded bad fixtures.

## Phase 2 - Repository Implementation

Implement new repository methods and remove stub behavior from runtime logic.

Add/replace methods in `server/modules/billing/repository.js`:

Definitions/templates:

- `listEntitlementDefinitions(...)`
- `findEntitlementDefinitionByCode(...)`
- `listPlanEntitlementTemplates(planId, ...)`
- `replacePlanEntitlementTemplates(planId, templates, ...)`
- `listProductEntitlementTemplates(productId, ...)`
- `replaceProductEntitlementTemplates(productId, templates, ...)`

Grants/consumptions:

- `insertEntitlementGrant(...)` idempotent by dedupe key
- `insertEntitlementConsumption(...)` idempotent by dedupe key

Projection:

- `findEntitlementBalance(...)`
- `upsertEntitlementBalance(...)`
- `recomputeEntitlementBalance(...)`
- `listNextGrantBoundariesForSubjectDefinition(...)`
- `leaseDueEntitlementBalances(...)` with `FOR UPDATE SKIP LOCKED`

Capacity support:

- resolver-facing hooks to pass current count into recompute, or helper methods to store/read snapshots.
- add explicit active project count primitive in projects repository (`status != archived`).

Delete or fully bypass stub behavior:

- `listPlanEntitlementsForPlan` as legacy schema source
- `incrementUsageCounter`
- `claimUsageEvent`

Success gate:

- Repository tests pass for idempotency, projection correctness, leasing semantics, and deterministic template replacement.

## Phase 3 - Billing Service Refactor

In `server/modules/billing/service.js`:

Implement core service entrypoints:

- `resolveEffectiveLimitations(...)`
- `consumeEntitlement(...)`
- `executeWithEntitlementConsumption(...)`
- `grantEntitlementsForPurchase(...)`
- `grantEntitlementsForPlanState(...)`
- `refreshDueLimitationsForSubject(...)`

Required service rules:

1. Canonical capability map must be centralized (from `consumable.md` section 5.4):
   - `projects.create -> projects.max`
   - `projects.unarchive -> projects.max`
   - `annuity.calculate -> annuity.calculations.monthly`
2. Capacity path:
   - no consumption row writes in scaffold v1
   - use current-count resolver or snapshots for `consumed_amount`
3. Metered/balance path:
   - write consumption rows idempotently
4. `executeWithEntitlementConsumption(...)` must use one transaction:
   - freshen
   - enforce
   - run mutation callback with same trx
   - consume (if metered/balance)
   - recompute
   - commit
   - emit realtime post-commit
5. If enforcement fails, rollback and return deterministic domain error.

Replace all existing limitation reads in `getLimitations(...)` to use projection tables (no stubs).

Success gate:

- Service tests prove atomic behavior and rollback safety.
- No runtime path depends on old usage counter stubs.

## Phase 4 - Console JSON Authoring -> Typed Templates

## 4A) Product authoring

Implement JSON edge contract from `consumable.md` 4.2.1:

Files:

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `src/views/console/useConsoleBillingProductsView.js`
- `src/views/console/ConsoleBillingProductsView.vue`

Requirements:

1. Add `entitlements` array to product create/update schema.
2. Validate each entry:
   - `code`
   - `amount`
   - `grantKind`
   - `durationDays` rules
   - optional metadata object
3. On create/update transaction:
   - persist product
   - replace typed product templates
4. Update semantics:
   - omitted entitlements => unchanged
   - empty array => clear templates
5. UI should allow JSON editing similar to plans, without over-engineering.

## 4B) Plan authoring

Implement JSON edge contract from `consumable.md` 4.2.2:

Files:

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `src/views/console/useConsoleBillingPlansView.js`
- `src/views/console/ConsoleBillingPlansView.vue`

Requirements:

1. Keep JSON shape scaffold-compatible (`code`, `schemaVersion`, `valueJson`).
2. Deterministic transformer to typed plan templates:
   - amount priority: `valueJson.amount`, `valueJson.limit`, `valueJson.max`
   - fail if none valid
   - default grant/effective/duration policies
3. Persist typed plan templates transactionally.
4. Do not allow runtime grant projection from raw JSON.

Success gate:

- Console create/update for plans/products can fully author templates with JSON input.
- Typed template tables are always runtime source.

## Phase 5 - Webhook + Plan Transition Grant Projection

Webhook path:

- In confirmed purchase projection flow, call `grantEntitlementsForPurchase(...)`.
- Ensure dedupe strategy prevents double grants on retries.
- Recompute balances in same transaction.
- Emit limits realtime event post-commit.

Plan state path:

- On current plan assignment change, apply `grantEntitlementsForPlanState(...)`.
- Ensure idempotent behavior if transition logic retries.
- Recompute balances and emit realtime.

Important:

- Never grant on return URL path.
- Keep existing checkout/session idempotency intact.

Success gate:

- Duplicate webhook replay produces one grant effect only.

## Phase 6 - Worker: Incremental Boundary Processing

Extend `server/modules/billing/workerRuntime.service.js`:

1. Add entitlement boundary tick (default 60s).
2. Lease due rows with `next_change_at <= now`, batched.
3. Use row locking safe for multiple workers.
4. Recompute and update `next_change_at`.
5. Emit realtime only on material change.
6. Retry-safe and idempotent.

Do not implement global hourly full recompute.

Success gate:

- Worker complexity is O(changed subjects), not O(all subjects).

## Phase 7 - Realtime + Client Invalidation

Shared realtime:

- `shared/realtime/eventTypes.js`
  - add topic `WORKSPACE_BILLING_LIMITS`
  - add event `WORKSPACE_BILLING_LIMITS_UPDATED`
- `shared/realtime/topicRegistry.js`
  - app surface: no extra billing-admin permission
  - admin surface: `workspace.billing.manage`

Event payload must include:

- `workspaceId`
- `workspaceSlug`
- `changedCodes`
- `changeSource` enum:
  - `purchase_grant`
  - `plan_grant`
  - `consumption`
  - `boundary_recompute`
  - `manual_refresh`
- `changedAt`

Client:

- `src/features/workspaceAdmin/queryKeys.js`
  - add `workspaceBillingLimitationsQueryKey(scope)`
- `src/services/realtime/realtimeEventHandlers.js`
  - register topic strategy
  - invalidate based on `changeSource`:
    - always limitations
    - plan-state for purchase_grant/plan_grant
    - purchases for purchase_grant
- local mutation handlers must invalidate immediately (same-tab freshness)
- keep polling fallback on limit-sensitive screens

Success gate:

- Cross-tab billing limits update without reload.
- Same-tab mutation reflects immediately.

## Phase 8 - Scaffold Integrations

## 8A) Projects (capacity example)

Files:

- `server/modules/projects/controller.js`
- `server/modules/projects/service.js`
- `server/modules/projects/repository.js`
- `server/modules/projects/schema.js`

Requirements:

1. Keep current create integration but map to canonical capability.
2. Add update/replace transition detection for `archived -> active`.
3. Enforce capacity on capacity-increasing transitions only.
4. Add active-count resolver primitive (`status != archived`).
5. Trigger capacity recompute on archive/unarchive transitions too.

## 8B) Annuity (metered example)

Files:

- `server/modules/annuity/controller.js`
- `server/runtime/controllers.js`
- `server/modules/history/service.js`
- `server/modules/history/repository.js`

Requirements:

1. Inject billing service into annuity controller wiring.
2. Call `executeWithEntitlementConsumption(...)` in annuity calculate endpoint.
3. Use capability `annuity.calculate`.
4. Use request command/idempotency key for usage dedupe.
5. Ensure history append supports optional trx.
6. Ensure append + consume are atomic in one transaction.

Success gate:

- Retried annuity request does not double-consume.

## Phase 9 - API Contract and UI Read Path

Server:

- Keep `GET /api/billing/limitations`, return projection-backed fields:
  - effective/granted/consumed/nextChangeAt/lockState/enforcementMode
  - generatedAt/stale

Client:

- `src/views/workspace-billing/useWorkspaceBillingView.js`
  - consume limitations query
  - surface values in a simple scaffold-readable UI block
  - no heavy UI redesign required

Purpose:

- make it obvious the consumable architecture works in UI.

## Phase 10 - Remove Legacy Limitation Runtime Paths

After new paths are wired and tested:

1. Remove old stub-dependent logic paths from billing service.
2. Remove dead helper methods no longer referenced.
3. Keep public API stable where possible.

Run grep checks and ensure no runtime code relies on:

- legacy usage counter stubs
- old plan entitlement JSON as runtime grant source

## Phase 11 - Testing Matrix (must implement)

Migration tests:

- create tables and constraints
- good path backfill
- fail-loud invariant paths

Repository tests:

- template replace semantics
- dedupe keys for grants/consumptions
- projection formulas by entitlement type
- worker leasing lock safety

Service tests:

- purchase-confirmed grant projection
- duplicate webhook no double grant
- plan transition grant projection
- projects create over-cap denied
- projects archived->active over-cap denied
- annuity success consumes once
- annuity retry no double consume
- transaction rollback on failed domain mutation

Realtime client tests:

- billing limits topic invalidates expected query keys by `changeSource`

Contract tests:

- limitations response shape and deterministic error payloads

## 12) Commands to Run and Report

Run and report exact outputs:

1. `npx eslint <all changed files>`
2. `npm run -s test -- <targeted server tests>`
3. `npm run -s test:client -- <targeted client tests>`
4. Any focused module tests you add for billing/realtime/console.

Also run grep checks:

1. no runtime dependency on limitation stubs
2. no runtime grant projection from raw product/plan JSON blobs

## 13) Final Response Requirements (next session)

Return:

1. Architecture summary of implemented changes.
2. Full changed-file list.
3. Migration/backfill behavior + invariant failure behavior.
4. API contract updates for limitations and realtime payload.
5. Console JSON authoring -> typed template persistence explanation.
6. Scaffold integration summary (projects + annuity).
7. Exact lint/test commands + pass/fail.
8. Follow-up manual steps (migrate, seed, worker run flags if needed).

## 14) Anti-Scope-Creep Rules

1. Do not redesign products/projects/annuity domains.
2. Do not build generic plugin frameworks beyond what current architecture needs.
3. Do not add broad lock-state UX redesign in scaffold phase.
4. Do not add unrelated billing catalog/product feature work.
5. Keep implementation focused on proving the consumables architecture with thin adapters.

## 15) Quality Bar

1. Deterministic behavior on retries/replays.
2. Clear failure messages on invariant violations.
3. Transactional correctness for enforce+mutate+consume flow.
4. No ambiguous source-of-truth in runtime grant projection.
5. Scaffold code remains minimal and deletable.

