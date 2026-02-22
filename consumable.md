# Consumable Entitlements Implementation Plan

Last updated: 2026-02-22
Status: Implementation blueprint (server + DB + workers + client realtime + rollout)
Scope: Replace the current limitations stub path with a first-class consumable entitlements engine that fits the existing billing architecture.

Scaffold policy:

- `projects` and annuity calculations are demo consumers only.
- They exist to prove wiring patterns and provide implementation templates for developers/AI agents.
- They are expected to be removed once real product-domain modules are in place.
- Core consumables architecture must not depend on scaffold tables/routes.

## 0) Why This Exists

The repository already has:

- RBAC permission checks (who can do what)
- billing plan assignments + provider details
- billing purchases ledger
- billing worker runtime
- realtime event fanout + query invalidation

But the current limitations engine is partially stubbed:

- `server/modules/billing/repository.js`
  - `listPlanEntitlementsForPlan()` returns `[]`
  - `findUsageCounter()`/`incrementUsageCounter()`/`claimUsageEvent()` are no-op stubs
- `migrations/20260222143000_drop_obsolete_billing_tables.cjs` removed old usage/entitlement tables

Goal: implement a clean, scalable consumables system without reintroducing legacy coupling.

## 1) Non-Negotiable Design Principles

1. Append-only source of truth for value-changing events.
2. Materialized projection for fast runtime checks/UI.
3. Idempotent writes everywhere (`operation_key`, webhook event id, usage event id, deterministic dedupe keys).
4. Time-bound grants use `effective_at` and `expires_at`; no ad-hoc “expiry mutation cron”.
5. No mutable totals as source of truth; totals are projections.
6. Incremental due-boundary processing (`next_change_at`) instead of global full recompute jobs.
7. Keep RBAC and entitlements separate:
   - RBAC: access control.
   - entitlements: quantity/credits/capacity/state.
8. Domain integrations must be thin adapters:
   - pass capability + subject + delta into billing core
   - keep domain-specific counting logic outside the core ledger/projection engine
9. Scaffold integrations must be cheap to delete:
   - no deep coupling from billing core to scaffold modules
   - no scaffold-specific branches in table design

## 2) Scaffold Policy Decisions (Locked for This Blueprint)

### 2.1 Disposable scaffold examples

For implementation and testing of the core engine:

- Default plan example includes:
  - a capacity cap (`projects.max`)
  - a metered quota (`annuity.calculations.monthly`)
- One disposable add-on product example:
  - `extra_projects_pack_2m`
  - grants extra active projects for 2 months
  - grants extra annuity calculations for the same period
- These are examples only and are expected to be removed/replaced when real product-domain limits are introduced.
- Core DB/service design must remain unchanged when those scaffold examples are deleted.

### 2.2 Purchase confirmation policy

- Grant business value only on confirmed webhook path.
- Never grant from success redirect URL.

### 2.3 Realtime freshness policy

- Same-tab: local invalidation immediately on successful mutation write paths.
- Cross-tab/cross-user: realtime topic publish + query invalidation.
- Fallback: short polling for missed socket events.

### 2.4 Thin-integration policy

- First implementation goal is to prove thin layering, not to perfect scaffold business semantics.
- Phase 1 enforcement should focus on capacity-increasing writes and metered debits.
- Advanced lock/read-remediation behavior can be deferred to real product-domain modules.

## 3) Fit Into Existing Architecture

## 3.1 Keep these boundaries

- `routes`: transport/schema only (`server/modules/billing/routes.js`)
- `controller`: HTTP parse/respond only (`server/modules/billing/controller.js`)
- `service`: business orchestration (`server/modules/billing/service.js`)
- `repository`: SQL + mappers (`server/modules/billing/repository.js`)
- worker loop: `server/modules/billing/workerRuntime.service.js`

No SQL in service/controller.

## 3.2 Existing modules to extend

- Billing runtime surface:
  - `server/modules/billing/service.js`
  - `server/modules/billing/repository.js`
  - `server/modules/billing/schema.js`
  - `server/modules/billing/routes.js`
  - `server/modules/billing/controller.js`
- Billing workers:
  - `server/modules/billing/workerRuntime.service.js`
- Realtime:
  - `shared/realtime/eventTypes.js`
  - `shared/realtime/topicRegistry.js`
  - `src/services/realtime/realtimeEventHandlers.js`
- Client billing view/query keys:
  - `src/features/workspaceAdmin/queryKeys.js`
  - `src/views/workspace-billing/useWorkspaceBillingView.js`

## 3.3 Existing permissions model remains

- RBAC manifest remains source for permissions (`shared/auth/rbac.manifest.json`).
- `workspace.billing.manage` still gates billing write actions.
- Entitlement checks run in billing service/use-case logic, not RBAC.

## 3.4 Thin domain adapter contract (important for scaffold nature)

- Billing core accepts generic inputs:
  - `subject` (usually billable entity)
  - `capability` / limitation code
  - `delta` (requested usage amount)
  - transactional action callback
- Domain modules provide minimal adapters:
  - how to count current usage for capacity checks
  - where to call `executeWithEntitlementConsumption(...)`
- Core engine never imports scaffold-specific repository methods directly (`workspace_projects`, annuity history internals, etc.).

## 3.5 Current HIGH/MEDIUM fit gaps and required fixes (locked)

These are mandatory plan items to ensure the blueprint fits the current repository without heavy scaffold rewrites.

1. Annuity atomicity gap (HIGH):
   - Problem: annuity execution currently cannot run `enforce + domain mutation + consume` in one transaction.
   - Plan fix:
     - billing service exposes a single transactional wrapper (`executeWithEntitlementConsumption`).
     - annuity controller calls that wrapper instead of direct history append.
     - annuity domain mutation callback receives and uses shared `trx`.
     - history service/repository add optional `trx` parameter pass-through.
     - runtime controller wiring injects billing service into annuity controller.
2. Project status-transition bypass gap (HIGH):
   - Problem: capacity checks can be bypassed through update/replace status transitions.
   - Plan fix:
     - keep create enforcement.
     - add thin transition check on patch/replace for `archived -> active` (or equivalent capacity-increasing transitions).
     - use one shared helper for transition detection to avoid controller boilerplate.
3. Dynamic catalog template source gap (HIGH):
   - Problem: catalog is runtime-editable, so migration/bootstrap must deterministically cover existing plans/products.
   - Plan fix:
     - `billing_plan_entitlement_templates` + `billing_product_entitlement_templates` become sole typed source-of-truth.
     - migration/bootstrap creates missing template rows for every active catalog item using deterministic defaults.
     - migration fails loud only when deterministic mapping is impossible (for example missing entitlement definition code).
4. Realtime topic permission ambiguity (MEDIUM):
   - Problem: if gated only by billing-admin permission, scaffold app consumers miss updates.
   - Plan fix:
     - `WORKSPACE_BILLING_LIMITS` topic on app surface is workspace-session scoped with invalidation-safe payload and no extra billing-admin permission requirement.
     - admin surface may still require `workspace.billing.manage`.
5. Active-project counting primitive gap (MEDIUM):
   - Problem: existing project count method is total rows, not active rows.
   - Plan fix:
     - add explicit domain resolver primitive for active projects (`status != archived` in scaffold).
     - entitlement enforcement uses resolver, not total row count.

## 4) Data Model (Physical Tables)

Naming convention: keep billing ownership explicit with `billing_` prefix.
Logical names in the request map as follows.

## 4.1 `entitlement_definitions` -> `billing_entitlement_definitions`

Purpose: catalog of capabilities and accounting behavior.

Columns:

- `id` bigint PK
- `code` varchar(120) unique, stable key (`projects.max`, `annuity.calculations.monthly`, `ai.credits`, `workspace.access`)
- `name` varchar(191)
- `description` text nullable
- `entitlement_type` enum:
  - `capacity` (count-based caps)
  - `metered_quota` (windowed usage caps)
  - `balance` (credits remaining)
  - `state` (boolean/state gates, e.g. workspace access)
- `unit` varchar(64) (`project`, `calculation`, `message`, `credit`, `workspace_state`)
- `window_interval` enum nullable (`day`, `week`, `month`, `year`, null)
- `window_anchor` enum nullable (`calendar_utc`, `rolling`, null)
- `aggregation_mode` enum (`sum`, `max`, `boolean_any_true`)
- `enforcement_mode` enum:
  - `hard_deny`
  - `hard_lock_resource` (optional, domain-specific lock mode)
  - `soft_warn`
- `scope_type` enum (`billable_entity`, `workspace`, `user`) default `billable_entity`
- `is_active` boolean
- `metadata_json` json nullable
- `created_at`, `updated_at`

Indexes/constraints:

- unique (`code`)
- index (`entitlement_type`, `is_active`)
- check constraints for valid combinations:
  - if `entitlement_type = metered_quota`, `window_interval` required
  - if `entitlement_type in (capacity, balance)`, `window_interval` null

## 4.2 Plan/Product templates (required to fit existing console workflows)

Without this, grant creation has no typed source.

### `billing_plan_entitlement_templates`

- `id` PK
- `plan_id` FK -> `billing_plans.id`
- `entitlement_definition_id` FK -> `billing_entitlement_definitions.id`
- `amount` bigint (or decimal for fractional credits if needed)
- `grant_kind` enum (`plan_base`, `plan_bonus`)
- `effective_policy` enum (`on_assignment_current`, `on_period_paid`)
- `duration_policy` enum (`while_current`, `period_window`, `fixed_duration`)
- `duration_days` int nullable
- `metadata_json` nullable
- timestamps

Constraints:

- unique (`plan_id`, `entitlement_definition_id`, `grant_kind`)

### `billing_product_entitlement_templates`

- `id` PK
- `billing_product_id` FK -> `billing_products.id`
- `entitlement_definition_id` FK
- `amount`
- `grant_kind` enum (`one_off_topup`, `timeboxed_addon`)
- `duration_days` nullable
- `metadata_json`
- timestamps

Constraints:

- unique (`billing_product_id`, `entitlement_definition_id`, `grant_kind`)

### 4.2.1 Console product authoring contract (JSON input, typed persistence)

For product create/update APIs, author entitlements as one JSON array per product payload:

- field: `entitlements`
- type: array of objects
- each entry:
  - `code` (entitlement definition code)
  - `amount` (positive integer for scaffold v1)
  - `grantKind` (`one_off_topup` or `timeboxed_addon`)
  - `durationDays` (required for timeboxed add-ons, null for one-off topups)
  - `metadataJson` (optional object)

Persistence rule (non-negotiable):

- JSON is the edge contract only.
- canonical runtime source remains typed rows in `billing_product_entitlement_templates`.
- create/update must write product row + template rows in one transaction.
- purchase grant projection reads typed templates only, never product metadata JSON.

Update semantics:

- default: replace template set for that product with the submitted `entitlements` array.
- omitted `entitlements` on update means "leave unchanged".
- explicit empty array means "clear all templates for this product".

### 4.2.2 Console plan authoring contract (JSON input, typed persistence)

For plan create/update APIs, keep JSON authoring for scaffold compatibility:

- field: `entitlements`
- type: array of objects
- current scaffold entry shape:
  - `code`
  - `schemaVersion`
  - `valueJson`

Deterministic transformer to typed plan templates:

- resolve `entitlement_definition_id` by `code` (fail if unknown).
- derive `amount` from first valid positive numeric field in priority order:
  1. `valueJson.amount`
  2. `valueJson.limit`
  3. `valueJson.max`
- fail validation if no valid amount can be derived.
- `grant_kind` default `plan_base` (allow override to `plan_bonus` only when explicitly provided in payload metadata policy).
- `effective_policy` default `on_assignment_current`.
- `duration_policy` default `while_current`.
- `duration_days` required only when `duration_policy` requires it.

Persistence rule:

- JSON is edge contract only.
- canonical runtime source is `billing_plan_entitlement_templates`.
- create/update must write plan row + template rows in one transaction.
- plan-derived grant projection reads typed templates only.

Update semantics:

- omitted `entitlements` on update means "leave unchanged".
- explicit empty array means "clear plan templates" (allowed only when plan should grant no entitlements).

## 4.3 `entitlement_grants` -> `billing_entitlement_grants`

Purpose: append-only credits/capacity/state grants.

Columns:

- `id` PK
- `subject_type` enum (`billable_entity`) for now
- `subject_id` bigint (FK logically to `billable_entities.id`)
- `entitlement_definition_id` FK
- `amount` bigint (for `state`, use 0/1 or boolean in metadata policy)
- `kind` enum:
  - `plan_base`
  - `addon_timeboxed`
  - `topup`
  - `promo`
  - `manual_adjustment`
  - `correction`
- `effective_at` datetime UTC
- `expires_at` datetime UTC nullable
- `source_type` enum:
  - `plan_assignment`
  - `billing_purchase`
  - `billing_event`
  - `manual_console`
  - `system_worker`
- `source_id` bigint nullable (FK where applicable)
- `operation_key` varchar(191) nullable
- `provider` varchar(32) nullable
- `provider_event_id` varchar(191) nullable
- `dedupe_key` varchar(191) not null
- `metadata_json` json nullable
- `created_at` datetime UTC

Constraints:

- unique (`dedupe_key`)
- index (`subject_type`, `subject_id`, `entitlement_definition_id`, `effective_at`)
- index (`subject_type`, `subject_id`, `expires_at`)
- index (`source_type`, `source_id`)
- check: `expires_at is null or expires_at > effective_at`

No update/delete in normal runtime paths (append-only rule).

## 4.4 `entitlement_consumptions` -> `billing_entitlement_consumptions`

Purpose: append-only debits/usage events.

Columns:

- `id` PK
- `subject_type` enum (`billable_entity`)
- `subject_id` bigint
- `entitlement_definition_id` FK
- `amount` bigint positive
- `occurred_at` datetime UTC (business event timestamp)
- `reason_code` varchar(120) (`ai.message`, `project.create`, `workspace.invite.accepted`)
- `operation_key` varchar(191) nullable
- `usage_event_key` varchar(191) nullable
- `provider_event_id` varchar(191) nullable
- `request_id` varchar(128) nullable
- `dedupe_key` varchar(191) not null
- `metadata_json` json nullable
- `created_at` datetime UTC

Constraints:

- unique (`dedupe_key`)
- optional unique on (`subject_id`, `entitlement_definition_id`, `usage_event_key`) where supported, else encoded in `dedupe_key`
- indexes on subject+definition+occurred_at

## 4.5 `entitlement_balances` -> `billing_entitlement_balances`

Purpose: fast projection for checks and UI. Derived only.

Columns:

- `id` PK
- `subject_type` enum (`billable_entity`)
- `subject_id` bigint
- `entitlement_definition_id` FK
- `window_start_at` datetime UTC not null
- `window_end_at` datetime UTC not null
- `granted_amount` bigint not null default 0
- `consumed_amount` bigint not null default 0
- `effective_amount` bigint not null default 0 (`granted - consumed` or derived cap)
- `hard_limit_amount` bigint nullable (for capacity/quota semantics)
- `over_limit` boolean not null default false
- `lock_state` enum nullable (`none`, `projects_locked_over_cap`, `workspace_expired`)
- `next_change_at` datetime UTC nullable (next future grant start/expiry boundary)
- `last_recomputed_at` datetime UTC not null
- `version` bigint not null default 0
- `metadata_json` json nullable
- `created_at`, `updated_at`

Constraints:

- unique (`subject_type`, `subject_id`, `entitlement_definition_id`, `window_start_at`, `window_end_at`)
- index (`next_change_at`)
- index (`subject_type`, `subject_id`, `entitlement_definition_id`)

Window normalization rule:

- non-windowed definitions (`capacity`, `balance`, most `state`) use sentinel lifetime bounds:
  - `window_start_at = 1970-01-01T00:00:00.000Z`
  - `window_end_at = 9999-12-31T23:59:59.999Z`
- windowed definitions (`metered_quota`) use real UTC window boundaries.

This avoids MySQL nullable-unique-key duplicate behavior.

## 4.6 Optional snapshots -> `billing_resource_snapshots`

Purpose: avoid expensive count queries under heavy load.

Columns:

- `id` PK
- `subject_type`, `subject_id`
- `resource_code` (`projects.active`, `workspace.members.active`, etc.)
- `resource_count`
- `snapshot_at`
- `source` (`event_driven`, `repair_recount`)
- timestamps

Constraints:

- unique (`subject_type`, `subject_id`, `resource_code`)

Note: for initial implementation, direct count queries are acceptable; snapshot table can be phase 2.

## 5) Idempotency and Dedupe Keys

## 5.1 Grant dedupe strategy (priority)

1. `provider_event_id + template_id + subject_id`
2. `billing_purchase_id + template_id`
3. `operation_key + template_id + subject_id`
4. deterministic fallback hash of immutable input

Stored in `billing_entitlement_grants.dedupe_key`.

## 5.2 Consumption dedupe strategy

1. explicit `usage_event_key` (best for app-origin usage)
2. `operation_key + reason_code + entitlement_definition_id + subject_id`
3. webhook provider identifiers when usage is provider-originated

Stored in `billing_entitlement_consumptions.dedupe_key`.

## 5.3 Invariant

Any retry/replay must produce the same dedupe key and become a no-op insert.

## 5.4 Canonical capability -> limitation mapping (scaffold v1)

Use one explicit mapping table in billing service config; do not scatter string literals across modules.

- `projects.create` -> `projects.max`
  - type: `capacity`
  - delta: `+1` requested active project footprint
  - reason: `project.create`
- `projects.unarchive` -> `projects.max`
  - type: `capacity`
  - delta: `+1` requested active project footprint
  - reason: `project.unarchive`
- `annuity.calculate` -> `annuity.calculations.monthly`
  - type: `metered_quota`
  - amount: `1` per successful calculation
  - reason: `annuity.calculate`

Rule:

- every new capability-integrated action must be added to this map before rollout.
- enforcement code must resolve from this map, not from hardcoded per-controller literals.

## 6) Mapping Your Two Limit Families

## 6.1 Numerical caps (`users.max`, `projects.max`, `workspaces.max`)

Definition:

- `entitlement_type = capacity`
- projection interprets `effective_amount` as allowed max count.

Enforcement (thin adapter style):

- on capacity-increasing actions, check:
  - `current_count + delta <= effective_cap`
- if false:
  - enforce per definition `enforcement_mode`
- `current_count` comes from a domain adapter/resolver, not from hardcoded core logic.
- capacity entitlements do not write `billing_entitlement_consumptions` rows in scaffold v1.
- capacity projections use resolver/snapshot counts as `consumed_amount` equivalent.

Scaffold example:

- `projects.max` is enforced only on capacity-increasing actions in scaffold phase (create/unarchive equivalents).
- Active count is domain-defined (`status != archived` for the scaffold projects table).
- Optional lock states (`hard_lock_resource`) are supported by the core model but not required for initial scaffold integration.

## 6.2 Refillable/depleting amounts (`annuity.calculations.monthly`, `ai.credits`, `ai.messages.monthly`)

Definitions:

- `metered_quota` for monthly execution limits (example: annuity calculations per month)
- `balance` for credits (no window unless product specifies expiry)

Enforcement:

- each usage writes a consumption row idempotently
- recompute projection in same transaction
- deny if resulting effective value below required threshold (`hard_deny`)

Refill:

- grant rows from purchases/promos/plan cycles

Expiry:

- automatically via `expires_at` boundary in grant query

## 7) Projection and Calculation Rules

## 7.1 Active grant predicate

Grant is active at `t` when:

- `effective_at <= t`
- and (`expires_at is null` or `expires_at > t`)

## 7.2 Window semantics

- capacity/balance/state: sentinel lifetime window (`1970-01-01` to `9999-12-31`)
- metered quota: calendar UTC windows (`month`, `week`, etc.)

## 7.3 Projection formulas

For each `(subject, definition, window)`:

- shared:
  - `granted_amount = SUM(active grants in scope)`
  - `next_change_at = MIN(future effective_at/expires_at of grants for same subject+definition)`
- capacity:
  - `consumed_amount = current_count` from domain resolver (or `billing_resource_snapshots`)
  - `hard_limit_amount = granted_amount`
  - `effective_amount = hard_limit_amount - consumed_amount`
  - `over_limit = consumed_amount > hard_limit_amount`
- metered_quota / balance:
  - `consumed_amount = SUM(consumptions in scope)`
  - `effective_amount = granted_amount - consumed_amount`
  - `hard_limit_amount = granted_amount` for `metered_quota`, nullable/derived for `balance`
  - `over_limit` based on definition enforcement semantics

## 7.4 Freshness rule

Before enforce/read:

- if `next_change_at` is null or `next_change_at > now`: projection is fresh enough
- if `next_change_at <= now`: recompute synchronously before decision
- capacity-specific freshness:
  - on every capacity-count-changing domain mutation (create/archive/unarchive/delete/invite accept/remove equivalents), recompute affected capacity balances immediately.
  - on capacity-sensitive enforcement reads, if resolver count differs from projected `consumed_amount`, synchronously recompute before allow/deny decision.

## 8) Incremental Due-Boundary Worker Model (No Global Cron Sweep)

## 8.1 Worker loop integration

Add another periodic tick inside `server/modules/billing/workerRuntime.service.js`:

- name: `entitlements-boundary`
- default interval: 60s

It must:

1. lease due balance rows where `next_change_at <= now` in batches (e.g. 100)
2. use `FOR UPDATE SKIP LOCKED` to avoid worker contention
3. recompute each row
4. update `next_change_at`
5. emit realtime event only when effective values/lock state changed

## 8.2 Repository methods required

Add to `server/modules/billing/repository.js`:

- `leaseDueEntitlementBalances({ now, limit, workerId })`
- `recomputeEntitlementBalance({ subjectId, entitlementDefinitionId, windowStartAt, windowEndAt, now, trx })`
- `upsertEntitlementBalance(...)`
- `listNextGrantBoundariesForSubjectDefinition(...)`

## 8.3 Complexity target

O(changed subjects), not O(all subjects).

## 9) Runtime Write Paths (Transactional)

## 9.1 Purchase confirmed webhook

Path today:

- webhook -> `billing_purchases` already written

Add:

1. resolve product templates from purchased product/price
2. insert grant rows idempotently
3. recompute affected balances in same transaction
4. emit billing-limits realtime event after commit

## 9.2 Plan state transitions

When assignment changes (`current` promoted/replaced):

1. resolve active plan templates
2. insert/update grant rows according to policy
3. recompute balances
4. emit realtime event

Important:

- Keep assignment table as source for plan state.
- Entitlement grant generation is a side-effect projection from plan state.

## 9.3 Usage consumption path

Replace the current post-action counter pattern with a transactional helper:

- `executeWithEntitlementConsumption(...)` (new billing service entrypoint)
- helper contract:
  1. begin transaction
  2. resolve+freshen balance (`next_change_at` check)
  3. enforce preconditions
  4. execute domain mutation callback with same `trx`
  5. if entitlement type is `metered_quota` or `balance`, insert consumption row idempotently
     if entitlement type is `capacity`, skip consumption insert and use active-count resolver for recompute
  6. recompute projection
  7. commit
  8. emit realtime invalidation after commit

If enforcement fails:

- rollback and return deterministic 409/429 contract based on configured mode.

## 10) API Contract Plan

Keep existing endpoint `GET /api/billing/limitations` and evolve it, do not fork a parallel API.

## 10.1 Response extensions

Per limitation include:

- `effectiveAmount`
- `grantedAmount`
- `consumedAmount`
- `nextChangeAt`
- `lockState` (if any)
- `enforcementMode`

Top-level include:

- `generatedAt`
- `stale` boolean (should remain false after sync refresh)

## 10.2 Optional new endpoint

`POST /api/billing/limits/refresh` (admin/debug only) to force recompute for selected workspace; useful for repair tooling.

## 10.3 Error contract additions

For blocked/locked capacity:

- `code`: `BILLING_CAPACITY_LOCKED`
- `details`:
  - `limitationCode`
  - `used`
  - `cap`
  - `overBy`
  - `lockState`
  - `requiredReduction`

For depleted credits/quota:

- keep deterministic `BILLING_LIMIT_EXCEEDED` payload style.

## 11) Realtime + Local Refresh Design (Critical)

## 11.1 Shared realtime constants

Update `shared/realtime/eventTypes.js`:

- add topic: `WORKSPACE_BILLING_LIMITS`
- add event type: `WORKSPACE_BILLING_LIMITS_UPDATED`

## 11.2 Topic policy

Update `shared/realtime/topicRegistry.js`:

- include new topic for `app` and `admin` surfaces
- required permissions (explicit, no ambiguity):
  - app surface: no extra billing-admin permission; rely on authenticated workspace session scope and invalidation-safe payload
  - admin surface: `workspace.billing.manage`

Use minimal payload to avoid sensitive data leakage:

- `workspaceId`, `workspaceSlug`
- changed limitation codes
- `changeSource` enum:
  - `purchase_grant`
  - `plan_grant`
  - `consumption`
  - `boundary_recompute`
  - `manual_refresh`
- `changedAt`

## 11.3 Server emit points

Add a billing realtime publisher helper (new file recommended):

- `server/modules/billing/realtimePublish.service.js`

Call after successful commits in:

- purchase grant projection
- plan-derived grant changes
- consumption updates
- boundary worker recomputes (only on material changes)

Emit with deterministic `changeSource` value so client invalidation does not rely on implicit heuristics.

## 11.4 Client invalidation wiring

Update `src/services/realtime/realtimeEventHandlers.js`:

- add strategy entry for `WORKSPACE_BILLING_LIMITS`
- invalidate:
  - always: new `workspaceBillingLimitationsQueryKey(scope)` (must be added to `src/features/workspaceAdmin/queryKeys.js`)
  - when `changeSource in {purchase_grant, plan_grant}`: `workspaceBillingPlanStateQueryKey(scope)`
  - when `changeSource = purchase_grant`: `workspaceBillingPurchasesQueryKey(scope)`
  - optional workspace/project scoped keys when lock-state affects access

Client query wiring requirement:

- add limitations query consumption in limit-sensitive screens (billing + any locked feature screens), not just query-key definition.
- add one shared client helper for low-boilerplate plumbing:
  - a single limitations query accessor used by billing/scaffold screens
  - a single invalidation helper used by local mutation success handlers

## 11.5 Local immediate refresh on mutation

In mutation success handlers (billing view + relevant app actions):

- call `queryClient.invalidateQueries(...)` immediately, even before socket event arrives.

This ensures same-tab consistency with no websocket dependency.

## 11.6 Polling fallback

For billing/limit-sensitive queries:

- set lightweight `refetchInterval` (e.g. 30s) only on pages where limit accuracy matters
- keep websocket as primary freshness mechanism

## 12) Workspace Expiry Modeling

Represent workspace access as entitlement definition:

- `code = workspace.access`
- `entitlement_type = state`
- amount/boolean semantics from grants

When expired:

- enforce in a centralized request gate after auth/workspace resolution (shared across modules), plus domain-specific checks where needed
  - blocked writes or full lock, depending on business setting
- projection sets `lock_state = workspace_expired`
- realtime event emitted for immediate UI reaction.

Implementation fit:

- add gate wiring in `server/fastify/auth.plugin.js` (or equivalent global pre-handler layer), not only inside billing service methods.

## 13) Migration Plan (One-way, deterministic, loud failure)

## 13.1 Migration order

1. Create new entitlement tables.
2. Seed definitions and template source rows:
   - definitions from explicit seed/migration data
   - template rows from typed template tables as source-of-truth
   - deterministic bootstrap for existing dynamic catalog rows (plans/products) to avoid uncovered entries
3. Backfill grants for currently active plan assignments/promo assignments.
4. Backfill consumption history only if reliable source exists (optional; can start from now for v1).
5. Seed/recompute `billing_entitlement_balances`.
6. Add indexes and constraints.
7. Remove old stub dependencies and dead code paths.

Migration DDL rule (MySQL safety):

- every FK/index/unique name must be explicitly set to <= 64 chars.

## 13.2 Backfill invariants

Fail migration if:

- unknown entitlement code references template
- duplicate dedupe key generation collisions
- invalid time windows (`expires_at <= effective_at`)
- subject missing for template expansion
- generated/declared identifier names exceed MySQL limits
- any active plan/product remains without required template coverage after deterministic bootstrap pass

## 13.3 Dynamic catalog bootstrap policy (important for current system)

- The system is runtime-editable (`billing_plans`, `billing_products`), so template coverage cannot depend on hand-maintained static lists.
- Backfill/bootstrap must iterate current catalog rows and ensure template rows exist for each applicable item.
- Bootstrap defaults are deterministic, documented, and idempotent.
- Console create/update flows must validate JSON `entitlements` payloads and write typed templates directly so post-migration runtime stays deterministic.
- Product rows without template coverage are invalid for entitlement-granting products; migration/bootstrap must fail loud.

Deterministic product classifier for migration/bootstrap:

- a product is entitlement-granting when any of these is true:
  1. it has at least one row in `billing_product_entitlement_templates`
  2. bootstrap input payload/source contains non-empty `entitlements` array for that product
  3. bootstrap metadata source contains explicit `metadata_json.entitlements` non-empty array (migration-only compatibility input)
- if classifier returns true and resulting typed template set is empty after bootstrap/validation, fail migration loudly.
- if classifier returns false, product is treated as non-entitlement product and no grant templates are required.

## 13.4 Irreversibility

Like current billing refactor migrations, mark down migration as irreversible.

## 14) Service and Repository Refactor Plan

## 14.1 Repository (`server/modules/billing/repository.js`)

Implement real methods for:

- definitions/templates CRUD reads
- grant insertion (idempotent)
- consumption insertion (idempotent)
- projection recomputation and upsert
- due-boundary leasing with row locks

Remove limitation-related stubs after replacements are live.

## 14.2 Service (`server/modules/billing/service.js`)

Replace current limitation internals with new engine entrypoints:

- `resolveEffectiveLimitations(...)`
- `consumeEntitlement(...)`
- `executeWithEntitlementConsumption(...)` (shared transactional wrapper for thin domain adapters)
- `grantEntitlementsForPurchase(...)`
- `grantEntitlementsForPlanState(...)`
- `refreshDueLimitationsForSubject(...)`

Keep controller signatures stable where possible.

## 14.3 Webhook projection integration

In webhook handlers:

- after confirmed purchase persistence:
  - call grant projection
  - recompute
  - publish realtime

Ensure this remains in same transaction scope when possible.

## 14.4 Worker runtime

Extend `server/modules/billing/workerRuntime.service.js` with boundary tick.

No global full-table sweep.

## 15) Thin Integration by Domain Action (Scaffold-first)

## 15.1 Scaffold example A: Projects module (minimal integration)

- Keep scaffold changes physically small.
- Integrate entitlement checks on capacity-increasing operations only:
  - create
  - status transitions that increase active footprint (`archived -> active` in update/replace paths)
- Use a thin usage resolver primitive for current active projects (`status != archived`).
- Reuse one transition detector helper for patch/replace to keep controller plumbing minimal.
- Do not implement broad read-lock behavior in scaffold phase unless explicitly needed.

Files likely touched minimally:

- `server/modules/projects/controller.js`
- `server/modules/projects/service.js`
- `server/modules/projects/repository.js`

## 15.2 Scaffold example B: Annuity calculations module (minimal integration)

- Before executing `/api/annuityCalculator`, call billing transactional wrapper for capability `annuity.calculate` mapped to limitation code `annuity.calculations.monthly`.
- Wrapper executes:
  - pre-enforcement
  - annuity append callback
  - consumption insert amount `1`
  - projection recompute
  - post-commit realtime emit
- Use idempotency key (`x-command-id`/request key) to dedupe retries.
- History append path must accept optional `trx` so annuity callback is truly atomic.

Files likely touched minimally:

- `server/modules/annuity/controller.js`
- `server/modules/billing/service.js`
- `server/runtime/controllers.js`
- `server/modules/history/service.js`
- `server/modules/history/repository.js`

## 15.3 Real domain modules (future pattern)

- Real business modules should integrate through the same thin adapter contract.
- Add/replace capability mappings and usage resolvers without changing core ledger/projection schema.
- Scaffold examples can be deleted without migration changes to the core engine.

## 16) Observability and Guardrails

Reuse existing billing guardrail pattern:

- emit guardrail events for:
  - grant insert no-op due to dedupe
  - consumption dedupe hits
  - stale balance refreshed synchronously on read
  - over-limit lock entered/exited
  - boundary worker recompute failures

Metrics:

- counters:
  - `entitlement_grant_insert_total`
  - `entitlement_consumption_insert_total`
  - `entitlement_projection_recompute_total`
  - `entitlement_lock_state_transition_total`
- histograms:
  - recompute latency
  - enforcement latency

## 17) Security and Data Integrity

1. Keep entitlement writes server-side only.
2. Never trust client-provided amount/capability for grant creation.
3. Validate subject ownership using existing `billingPolicyService`.
4. Keep webhook signature verification mandatory.
5. Store minimal realtime payloads; no raw monetary/provider payloads over socket topics.

## 18) Testing Plan (Detailed)

## 18.1 Migration tests

- create definitions/templates/grants/consumptions/balances tables
- backfill from:
  - active plan assignment
  - upcoming promo fallback
  - confirmed product purchase
- invariant failure tests (bad windows, duplicate dedupe key collisions)

## 18.2 Repository tests

- dedupe behavior for grants/consumptions
- projection correctness across:
  - active grant
  - future grant
  - expired grant
  - overlapping grants
- `next_change_at` correctness
- `FOR UPDATE SKIP LOCKED` leasing behavior

## 18.3 Service tests

- purchase confirmed -> grant + recompute + event
- duplicate webhook -> no duplicate grant/consumption
- console plan create/update with JSON `entitlements` writes expected typed plan template rows
- console product create/update with JSON `entitlements` writes expected typed product template rows
- scaffold capacity overflow blocks capacity-increasing write (projects example)
- scaffold project update/replace archived->active path is blocked when over cap
- scaffold capacity recompute is triggered on archive/unarchive transitions and reflects updated lock state
- scaffold metered quota decrements for annuity calculation execution
- metered consumption decrements correctly with idempotency
- synchronous refresh when `next_change_at <= now`
- transactional helper guarantees mutation+consumption atomicity with shared `trx`

## 18.4 Worker tests

- due-boundary tick processes only due balances
- emits realtime only on material change
- safe retry on transient failures

## 18.5 Realtime client tests

- new billing-limits topic invalidates expected query keys
- bootstrap refresh behavior where required
- same-tab local invalidation still updates UI without socket

## 18.6 Contract tests

- `GET /api/billing/limitations` shape with new fields
- deterministic error payloads for lock/depletion

## 19) Rollout Plan

## Phase A: Schema + repository primitives

- ship tables + repository methods + migration tests
- no runtime behavior switch yet

## Phase B: Shadow projection

- run fixture-based contract validation (golden scenarios), not old-runtime drift compare
- add recompute-from-ledger drift checks:
  - projected balance equals full ledger recomputation for sampled subjects
- keep optional old-runtime compare disabled until baseline is non-stubbed

## Phase C: Cutover

- switch `getLimitations` and enforcement to new projection path
- enable worker boundary tick
- enable realtime billing-limits topic

## Phase D: Cleanup

- delete old limitation stubs
- remove dead capability code paths that are no longer used
- update docs and runbooks

## 20) “Should Existing Grants/Permissions System Be Adapted?”

Yes, with separation of concerns:

- Keep existing RBAC grants/permissions model unchanged for access control.
- Adapt the billing limitations side into this consumable entitlements engine.
- Do not merge RBAC and quantitative entitlements into one table.

Reason:

- RBAC changes by membership/role semantics.
- consumables change by purchases, plan state, usage events, and expiry boundaries.
- lifecycle, auditing, and idempotency requirements are different.

## 20.1) Scaffold lifecycle and teardown rules

- `projects` and annuity integrations are temporary proving grounds.
- They should remain readable templates for:
  - capability mapping
  - transactional enforce+consume wrapper usage
  - domain usage resolver wiring
- When real product-domain modules are ready, scaffold limits/routes can be removed.
- Core success criterion for teardown:
  - remove scaffold adapters without changing entitlement ledger/projection schema or worker model.

## 21) File-Level Implementation Checklist

DB/migrations:

- `migrations/<timestamp>_create_billing_entitlements_engine_tables.cjs`
- `migrations/<timestamp>_backfill_billing_entitlement_definitions_and_templates.cjs`
- `migrations/<timestamp>_backfill_billing_entitlement_grants_and_balances.cjs`

Server billing:

- `server/modules/billing/repository.js`
- `server/modules/billing/service.js`
- `server/modules/billing/schema.js`
- `server/modules/billing/routes.js` (if new endpoint/query schema needed)
- `server/modules/billing/controller.js` (minimal contract wiring only)
- `server/modules/billing/workerRuntime.service.js`
- `server/modules/billing/webhookSubscriptionProjection.service.js`
- `server/modules/billing/purchaseLedgerProjection.utils.js`
- `server/modules/billing/realtimePublish.service.js` (new)

Console product entitlement authoring (JSON edge, typed persistence):

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `src/views/console/useConsoleBillingProductsView.js`
- `src/views/console/ConsoleBillingProductsView.vue`

Console plan entitlement authoring (JSON edge, typed persistence):

- `server/modules/console/schema.js`
- `server/domain/console/services/billingCatalog.service.js`
- `server/domain/console/services/consoleBilling.service.js`
- `src/views/console/useConsoleBillingPlansView.js`
- `src/views/console/ConsoleBillingPlansView.vue`

Server shared enforcement:

- `server/fastify/auth.plugin.js` (global entitlement gate integration)

Scaffold adapters (minimal, disposable):

- `server/modules/projects/controller.js`
- `server/modules/projects/service.js`
- `server/modules/projects/repository.js`
- `server/modules/projects/schema.js`
- `server/modules/annuity/controller.js`
- `server/runtime/controllers.js`
- `server/modules/history/service.js`
- `server/modules/history/repository.js`

Realtime shared/client:

- `shared/realtime/eventTypes.js`
- `shared/realtime/topicRegistry.js`
- `src/services/realtime/realtimeEventHandlers.js`
- `src/features/workspaceAdmin/queryKeys.js`
- `src/views/workspace-billing/useWorkspaceBillingView.js`

Docs:

- `docs/billing/contracts.md`
- `docs/billing/README.md`
- `docs/BILLABLE_DATA_TABLES.md` (new tables)

Tests:

- billing repository/service/worker/realtime suites in `tests/` and `tests/client/`

## 22) Acceptance Criteria

1. Limitation checks no longer depend on stubbed repository methods.
2. Every grant/consumption mutation is idempotent and append-only.
3. `next_change_at` incremental boundary model is active (no global full recompute job).
4. Cross-tab billing limit changes propagate through realtime topic + query invalidation.
5. Same-tab changes refresh immediately on mutation success.
6. Scaffold examples (`projects.max`, `annuity.calculations.monthly`, `extra_projects_pack_2m`) prove thin integration without coupling core billing to scaffold modules.
7. API contracts are deterministic and documented.
8. Worker retries do not cause double grants or double consumptions.
9. Capacity enforcement cannot be bypassed via scaffold status transitions (`archived -> active` paths covered).
10. Every active plan/product has deterministic entitlement template coverage.
11. App-surface workspace users receive billing-limit invalidation events without requiring billing-admin permission.
