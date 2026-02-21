# Stripe and Billing Plan v22 (Merged Phase 2 Program)

## 0) Phase 1 Scope Decisions (Locked)

- Billable entity is workspace-only in Phase 1.
- Billing routes are surface-agnostic for UX, but authorization is workspace + RBAC based.
- Billing writes (`checkout`, `portal`, subscription mutations) must never use `lastActiveWorkspace`.
- Checkout in Phase 1 is create-only: it is only for entities without a current subscription.
- At most one in-flight checkout may exist per billable entity.
- At most one blocking checkout session (`open`, `completed_pending_subscription`, or `recovery_verification_pending`) may exist per billable entity.
- Plan changes for existing subscriptions use provider portal in Phase 1.
- Payment-method synchronization is Phase 2.1 only.
- Phase 1 provider is Stripe, but provider interfaces remain pluggable.
- Phase 1 Stripe integration uses the official `stripe` Node SDK only (no custom Stripe HTTP client).
- Stripe SDK initialization is centralized and pinned by lockfile; explicit `apiVersion` is required.
- Recovery replay provenance is enforced for provider-create replays with unknown `provider_session_id`: runtime Stripe `apiVersion` must equal persisted `provider_api_version`, and runtime SDK major must equal persisted `provider_sdk_version` major.
- If recovery cannot safely replay while provider outcome is unknown (for example replay-window elapsed or provenance mismatch), recovery must persist a blocking checkout-session hold (`recovery_verification_pending`) before idempotency is finalized as `failed`/`expired` when conservative session-risk horizon has not elapsed.
- Unknown-outcome recovery holds must remain blocking until a conservative checkout-session lifetime upper bound has elapsed (`provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`), not just until idempotency replay deadline.
- Phase 1 Stripe checkout create params must always include explicit `expires_at`; `provider_checkout_session_expires_at_upper_bound` is copied from this frozen param (no omission fallback).
- Open checkout-session auto-expiry uses a safety grace window (`CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`, default 90s) before local blocking is cleared without provider-expired evidence.
- Phase 1 currency mode is single deployment billing currency (`BILLING_CURRENCY`, for example `USD`).
- Webhook event ownership is explicit: `customer.subscription.*` is authoritative for subscription lifecycle; `checkout.session.*` is correlation/idempotency state only.
- Stripe status mapping is explicit and enforced; `incomplete` is non-terminal and blocks new checkout.
- Subscription canonical-selection inputs are persisted (`provider_subscription_created_at`) for deterministic duplicate remediation.
- Idempotency recovery leases use monotonic fencing (`lease_version`) to prevent stale-writer finalization.
- Checkout-session ownership correlation is persisted and enforced (`operation_key`, provider object IDs); mismatch fails closed and alerts.
- Checkout-session lifecycle transitions are monotonic; reconciled/non-blocking states must never regress to blocking states.
- Recovery hold materialization is also monotonic: if a correlated checkout-session row already exists, recovery must preserve/advance that state and must not overwrite it with a more-blocking state.
- Frozen provider request params are stored as canonical SDK-call params JSON with stable hashes.
- Failure codes are canonical and API-facing; response errors must surface persisted `failure_code` deterministically.
- Recovery replay of provider create calls is allowed only while provider idempotency retention windows are still open (Phase 1 Stripe uses a 23-hour safety deadline under Stripe's 24-hour key retention).
- Recovery finalization must materialize `billing_checkout_sessions` blocking state before marking checkout idempotency rows `succeeded`.
- Pending recovery uses a two-transaction flow (lease then finalize) so provider calls happen outside DB transactions and finalization reuses the global entity lock order.
- Provider create outcomes with indeterminate commit state (timeout/reset/5xx/429/process interruption after dispatch) must remain `pending` and be resolved only through recovery; synchronous flow must not mark them `failed`/`expired`.

## 1) Trust and Authorization Model

- Do not use client `x-surface-id` as an authorization input for billing.
- Billing authorization input is:
  - authenticated user
  - resolved workspace context
  - billing permission (for example `workspace.billing.manage`)
- `supportsBillingWrites` is a policy/UI capability flag, not a standalone security boundary.
- Billing routes do not accept `surfaceId`, `billableEntityId`, `providerPriceId`, or other provider IDs from clients.
- Billing write workspace resolution:
  - explicit workspace selector (`x-workspace-slug`, route param, or query) when authorized
  - else singleton accessible workspace
  - else `409 Workspace selection required`
  - never fallback to `lastActiveWorkspace`

## 2) Data Model (MySQL-Safe, Phase 1 Strict)

Nullability rule:
- Any FK column with `ON DELETE SET NULL` must be nullable in schema DDL.

### 2.1 `billable_entities` (workspace-backed in Phase 1)

- `id` (PK)
- `workspace_id` (`bigint unsigned`, not null)
- `owner_user_id` (`bigint unsigned`, not null)
- `status` (`active`, `inactive`)
- timestamps
- **Unique**: `(workspace_id)`
- **Indexes**: `owner_user_id`
- **FK**: `workspace_id -> workspaces.id` (`ON DELETE RESTRICT`)
- **FK**: `owner_user_id -> user_profiles.id` (`ON DELETE RESTRICT`)

Note: no polymorphic entity type in Phase 1. Additional entity types are a future migration (Phase 2.4).

### 2.2 `billing_customers`

- `id`, `billable_entity_id`, `provider`, `provider_customer_id`
- optional `email`, `metadata_json`
- timestamps
- **Unique**: `(provider, provider_customer_id)`
- **Unique**: `(billable_entity_id, provider)`
- **Unique**: `(id, billable_entity_id, provider)` (composite FK target)
- **FK**: `billable_entity_id -> billable_entities.id` (`ON DELETE RESTRICT`)

### 2.3 `billing_plans`

- `id`, `code`, `plan_family_code`, `version`, `name`, `description`
- `applies_to = workspace` (Phase 1)
- `pricing_model` (`flat`, `per_seat`, `usage`, `hybrid`)
- `is_active`, `metadata_json`, timestamps
- **Unique**: `code`
- **Unique**: `(plan_family_code, version)`
- immutable for commercial behavior

### 2.4 `billing_plan_prices`

- `id`, `plan_id`, `provider`
- `billing_component` (`base`, `seat`, `metered`, `add_on`)
- `usage_type` (`licensed`, `metered`)
- `interval`, `interval_count`, `currency`, `unit_amount_minor`
- `provider_product_id`, `provider_price_id`
- `is_active`, `metadata_json`, timestamps
- generated column:
  - `phase1_sellable_price_key = CASE WHEN is_active = 1 AND usage_type = 'licensed' AND billing_component = 'base' THEN CONCAT(plan_id, ':', provider) ELSE NULL END`
- **Unique**: `(provider, provider_price_id)`
- **Unique**: `(id, provider)` (composite FK target)
- **Unique**: `phase1_sellable_price_key` (Phase 1 determinism guard: one sellable recurring price per plan/provider)
- **Indexes**: `(plan_id, is_active)`, `(plan_id, provider)`
- **FK**: `plan_id -> billing_plans.id` (`ON DELETE RESTRICT`)

Phase 1 checkout must only use this one sellable licensed recurring row.
Phase 1 currency policy:
- all sellable prices used for checkout must match deployment `BILLING_CURRENCY`
- mismatched-currency rows are invalid for Phase 1 checkout resolution

### 2.5 `billing_entitlements`

- `id`, `plan_id`, `code`, `schema_version`, `value_json`
- `schema_version` must resolve to a canonical JSON schema in the entitlement schema registry.
- `value_json` must validate against the resolved schema at write time.
- **Unique**: `(plan_id, code)`
- **FK**: `plan_id -> billing_plans.id` (`ON DELETE RESTRICT`)

### 2.6 `billing_subscriptions`

- `id`, `billable_entity_id`, `plan_id`, `billing_customer_id`
- `provider`, `provider_subscription_id`
- `status` (`incomplete`, `trialing`, `active`, `past_due`, `paused`, `unpaid`, `canceled`, `incomplete_expired`)
- `provider_subscription_created_at` (immutable provider object creation timestamp)
- `current_period_end`, `trial_end`, `canceled_at`, `cancel_at_period_end`, `ended_at`
- `is_current` (default false)
- `last_provider_event_created_at`, `last_provider_event_id`
- `metadata_json`, timestamps
- generated column:
  - `current_subscription_key = CASE WHEN is_current = 1 THEN billable_entity_id ELSE NULL END`
- **Unique**: `(provider, provider_subscription_id)`
- **Unique**: `current_subscription_key`
- **Unique**: `(id, provider)` (composite FK target)
- **Index**: `(billable_entity_id, status)`
- **FK**: `(billing_customer_id, billable_entity_id, provider) -> billing_customers(id, billable_entity_id, provider)` (`ON DELETE RESTRICT`)
- **FK**: `plan_id -> billing_plans.id` (`ON DELETE RESTRICT`)
- **Check constraint**:
  - `is_current = 0 OR status IN ('incomplete', 'trialing', 'active', 'past_due', 'paused', 'unpaid')`

Service invariant (required even if DB check support is limited):
- transitions to terminal statuses must clear `is_current` in the same transaction.
- terminal statuses in Phase 1: `canceled`, `incomplete_expired`.
- `provider_subscription_created_at` must be populated from provider object data on first authoritative subscription write and never mutated afterward.

### 2.7 `billing_subscription_items`

- `id`, `subscription_id`, `provider`, `provider_subscription_item_id`
- `billing_plan_price_id` (nullable for reconciliation fallback)
- `billing_component`, `usage_type`, `quantity`, `is_active`
- `last_provider_event_created_at`, `last_provider_event_id`
- `metadata_json`, timestamps
- **Unique**: `(provider, provider_subscription_item_id)`
- **Indexes**: `(subscription_id, is_active)`, `billing_plan_price_id`
- **FK**: `(subscription_id, provider) -> billing_subscriptions(id, provider)` (`ON DELETE RESTRICT`)
- **FK**: `(billing_plan_price_id, provider) -> billing_plan_prices(id, provider)` (nullable, `ON DELETE RESTRICT`)

### 2.8 `billing_invoices`

- `id`, `subscription_id` (nullable), `billable_entity_id`, `billing_customer_id`, `provider`, `provider_invoice_id`
- `status`, `amount_due_minor`, `amount_paid_minor`, `amount_remaining_minor`
- `currency`, `issued_at`, `due_at`, `paid_at`
- `last_provider_event_created_at`, `last_provider_event_id`
- `metadata_json`, timestamps
- **Unique**: `(provider, provider_invoice_id)`
- **Unique**: `(id, provider)` (composite FK target)
- **Indexes**: `(billable_entity_id, updated_at)`, `(billing_customer_id, provider)`
- **FK**: `(subscription_id, provider) -> billing_subscriptions(id, provider)` (`ON DELETE RESTRICT`, nullable FK)
- **FK**: `billable_entity_id -> billable_entities.id` (`ON DELETE RESTRICT`)
- **FK**: `(billing_customer_id, billable_entity_id, provider) -> billing_customers(id, billable_entity_id, provider)` (`ON DELETE RESTRICT`)

### 2.9 `billing_payments`

- `id`, `invoice_id`, `provider`, `provider_payment_id`, `type`, `status`
- `amount_minor`, `currency`, `paid_at`
- `last_provider_event_created_at`, `last_provider_event_id`
- `metadata_json`, timestamps
- **Unique**: `(provider, provider_payment_id)`
- **FK**: `(invoice_id, provider) -> billing_invoices(id, provider)` (`ON DELETE RESTRICT`)

### 2.10 `billing_webhook_events`

- `id`, `provider`, `provider_event_id`, `event_type`
- `provider_created_at`
- `status` (`received`, `processing`, `processed`, `failed`)
- `received_at`, `processing_started_at`, `processed_at`, `last_failed_at`
- `attempt_count`, `payload_json`, `payload_retention_until`, `error_text`
- timestamps
- **Unique**: `(provider, provider_event_id)`
- **Indexes**: `(status, updated_at)`, `received_at`

### 2.11 `billing_request_idempotency`

- `id`, `billable_entity_id`, `action` (`checkout`, `portal`, `payment_link`)
- `client_idempotency_key` (required inbound key)
- `request_fingerprint_hash`
- `normalized_request_json` (canonical payload snapshot used for replay/recovery)
- `operation_key` (deterministic HMAC: stable per action + entity + client key)
- `provider_request_params_json` (canonical Stripe SDK request params snapshot for `checkout.sessions.create`)
- `provider_request_hash`
- `provider_request_schema_version` (for example `stripe_checkout_session_create_params_v1`)
- `provider_sdk_name` (Phase 1: `stripe-node`)
- `provider_sdk_version` (resolved package version at runtime for audit)
- `provider_api_version` (effective Stripe API version used by SDK client)
- `provider_request_frozen_at`
- `provider`, `provider_idempotency_key`
- `provider_idempotency_replay_deadline_at` (hard stop for provider-create replay when `provider_session_id` is unknown; Phase 1 Stripe default: `created_at + 23h`)
- `provider_checkout_session_expires_at_upper_bound` (conservative max time the original provider checkout session may still be valid when outcome is unknown; for Phase 1 Stripe this must equal frozen checkout params `expires_at`, with no omission fallback)
- `provider_session_id`, `response_json`
- `status` (`pending`, `succeeded`, `failed`, `expired`)
- `pending_lease_expires_at`, `pending_last_heartbeat_at`, `lease_owner`
- `lease_version` (monotonic fencing token for pending recovery/finalization)
- `recovery_attempt_count`, `last_recovery_attempt_at`
- `failure_code`, `failure_reason`
- `expires_at`, timestamps
- generated column:
  - `active_checkout_pending_key = CASE WHEN action = 'checkout' AND status = 'pending' THEN billable_entity_id ELSE NULL END`
- **Unique**: `(billable_entity_id, action, client_idempotency_key)`
- **Unique**: `(action, operation_key)`
- **Unique**: `(provider, provider_idempotency_key)`
- **Unique**: `active_checkout_pending_key`
- **Indexes**: `(billable_entity_id, action, created_at)`, `(status, pending_lease_expires_at)`, `provider_idempotency_replay_deadline_at`, `expires_at`
- **FK**: `billable_entity_id -> billable_entities.id` (`ON DELETE RESTRICT`)

`active_checkout_pending_key` is the single-active-pending-checkout-request guard for Phase 1.

### 2.12 `billing_reconciliation_runs`

- `id`, `provider`, `scope`, `status` (`running`, `succeeded`, `failed`)
- `runner_id`, `lease_expires_at`
- `lease_version` (monotonic fencing token)
- `started_at`, `finished_at`
- `cursor_json`, `summary_json`
- `scanned_count`, `drift_detected_count`, `repaired_count`
- `error_text`, timestamps
- generated column:
  - `active_run_key = CASE WHEN status = 'running' THEN CONCAT(provider, ':', scope) ELSE NULL END`
- **Unique**: `active_run_key` (single active run per provider/scope)
- **Indexes**: `(provider, started_at)`, `(status, updated_at)`

### 2.13 `billing_subscription_remediations`

- `id`, `billable_entity_id`, `provider`
- `canonical_provider_subscription_id` (required stable canonical target)
- `canonical_subscription_id` (nullable local FK when not yet resolved)
- `duplicate_provider_subscription_id`
- `action` (`cancel_duplicate_subscription`)
- `status` (`pending`, `in_progress`, `succeeded`, `failed`, `dead_letter`)
- `selection_algorithm_version` (for example `dup_canonical_v1`)
- `attempt_count`, `next_attempt_at`, `last_attempt_at`, `resolved_at`
- `lease_owner`, `lease_expires_at`
- `lease_version` (monotonic fencing token)
- `error_text`, `metadata_json`, timestamps
- **Check constraint**:
  - `canonical_provider_subscription_id <> duplicate_provider_subscription_id`
- **Unique**: `(provider, duplicate_provider_subscription_id, action)`
- **Indexes**: `(billable_entity_id, status, updated_at)`, `(status, next_attempt_at)`
- **FK**: `billable_entity_id -> billable_entities.id` (`ON DELETE RESTRICT`)
- **FK**: `canonical_subscription_id -> billing_subscriptions.id` (`ON DELETE SET NULL`)

### 2.14 `billing_outbox_jobs`

- `id`, `job_type`, `dedupe_key`
- `payload_json`
- `status` (`pending`, `leased`, `succeeded`, `failed`, `dead_letter`)
- `available_at`, `attempt_count`
- `lease_owner`, `lease_expires_at`
- `lease_version` (monotonic fencing token)
- `last_error_text`, `finished_at`
- timestamps
- **Unique**: `(job_type, dedupe_key)`
- **Indexes**: `(status, available_at)`, `(job_type, status, updated_at)`

Use outbox for external side effects (provider cancels, repair API calls), never inside core aggregate DB transactions.
Outbox dedupe keys must be deterministic and namespaced per job type.

### 2.15 `billing_checkout_sessions`

- `id`, `billable_entity_id`, `provider`
- `provider_checkout_session_id`
- `idempotency_row_id` (nullable creator idempotency row)
- `operation_key` (immutable correlation key copied from idempotency row)
- `provider_customer_id` (nullable until known)
- `provider_subscription_id` (nullable until known)
- `status` (`open`, `completed_pending_subscription`, `recovery_verification_pending`, `completed_reconciled`, `expired`, `abandoned`)
- `checkout_url`, `expires_at`, `completed_at`
- `last_provider_event_created_at`, `last_provider_event_id`
- `metadata_json`, timestamps
- generated column:
  - `active_checkout_block_key = CASE WHEN status IN ('open', 'completed_pending_subscription', 'recovery_verification_pending') THEN billable_entity_id ELSE NULL END`
- **Unique**: `(provider, provider_checkout_session_id)`
- **Unique**: `(provider, operation_key)`
- **Unique**: `idempotency_row_id`
- **Unique**: `(provider, provider_subscription_id)` (nullable; enforces single session correlation target)
- **Unique**: `active_checkout_block_key` (at most one blocking checkout session per billable entity)
- **Indexes**: `(billable_entity_id, status)`, `(status, expires_at)`
- **FK**: `billable_entity_id -> billable_entities.id` (`ON DELETE RESTRICT`)
- **FK**: `idempotency_row_id -> billing_request_idempotency.id` (`ON DELETE SET NULL`)

`billing_checkout_sessions` is the source of truth for checkout-session blocking (`open`, post-completion pre-subscription windows, and unknown-outcome recovery holds), separate from request-idempotency pending state.

Service invariant (required):
- checkout-session state transitions are monotonic and must never regress to a more-blocking state.
- allowed transitions:
  - `open -> completed_pending_subscription | expired | abandoned`
  - `completed_pending_subscription -> completed_reconciled | abandoned`
  - `recovery_verification_pending -> open | completed_pending_subscription | completed_reconciled | expired | abandoned`
  - `completed_reconciled` is terminal for lifecycle progression in Phase 1
  - `expired` and `abandoned` are terminal
- disallowed examples: `completed_reconciled -> completed_pending_subscription`, `expired -> open`, `abandoned -> open`.

## 3) Idempotency and Recovery Rules (Inbound + Provider)

- Public billing writes require `Idempotency-Key` header.
- Fingerprint hash includes:
  - `billableEntityId`
  - `action`
  - normalized request payload fields relevant to action
- Claim behavior (`claimOrReplay`) is transactional and uses row locks:
  - first request inserts `pending` with:
    - deterministic `operation_key`
    - deterministic `provider_idempotency_key`
    - `pending_lease_expires_at = now + lease_ttl_seconds` (Phase 1 default: 120s)
    - `lease_version = 1`
  - duplicate with different fingerprint returns `409` with code `idempotency_conflict`
  - duplicate with same fingerprint and `status = succeeded` replays `response_json`
  - duplicate with same fingerprint and `status = failed` or `expired` replays prior failure envelope
  - duplicate with same fingerprint and active `pending` lease returns `409` with code `request_in_progress`
- Provider request freezing rule (required for checkout):
  - materialize Stripe `checkout.sessions.create` params once (customer, line items, quantity, success/cancel URLs, metadata, `expires_at`)
  - Phase 1 Stripe requires explicit frozen `expires_at = provider_request_frozen_at + 24h`
  - canonicalize params using deterministic JSON key ordering for hashing/persistence
  - persist `provider_request_params_json` + `provider_request_hash` + `provider_request_schema_version`
  - persist `provider_checkout_session_expires_at_upper_bound = frozenParams.expires_at`
  - persist SDK/API provenance: `provider_sdk_name`, `provider_sdk_version`, `provider_api_version`
  - missing frozen `expires_at` is an invariant violation: fail closed, do not call provider create, and alert
  - all retries/recovery must call SDK with the exact stored params snapshot (never recompute from mutable DB state)
- Checkout request concurrency guard:
  - if another checkout row is already `pending` for the same billable entity, return `409` with code `checkout_in_progress`
  - this guard applies even when the second request uses a different client idempotency key
- Checkout session concurrency guard:
  - enforced by `billing_checkout_sessions.active_checkout_block_key`
  - blocks new checkout creation while either:
    - a non-expired `status = open` checkout session exists (`expires_at > now - CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`; `409 checkout_session_open`)
    - a `status = completed_pending_subscription` session exists (`409 checkout_completion_pending`)
    - a `status = recovery_verification_pending` session exists (`409 checkout_recovery_verification_pending`)
- Checkout-session correlation rule:
  - checkout create call metadata must include `operation_key`, `billable_entity_id`, and idempotency row reference
  - webhook/finalization paths must verify metadata-to-row correlation before mutation; mismatch is fail-closed + alert
- Recovery-hold materialization rule:
  - branches that might write `recovery_verification_pending` must run in a short fenced transaction using the global entity lock order
  - load correlated `billing_checkout_sessions` by `(provider, operation_key)` before writing hold state
  - if correlated row exists in `open` or `completed_pending_subscription`, keep existing blocking state (do not rewrite status)
  - if correlated row exists in `completed_reconciled`, `expired`, or `abandoned`, do not create/regress to `recovery_verification_pending`
  - only when no correlated row exists and unknown-outcome risk horizon is open may recovery insert `recovery_verification_pending`
- Pending recovery semantics:
  - when lease expires, next same-fingerprint retry can acquire lease ownership and enter recovery mode
  - lease acquire/renew increments `lease_version`; recovery/finalization writes must assert the expected `lease_version`
  - recovery sequence:
    1. **Tx R1 (lease acquire; short transaction)**:
       - lock idempotency row `FOR UPDATE`
       - increment `recovery_attempt_count`, set `last_recovery_attempt_at`, extend lease, bump `lease_version`
       - persist the expected `lease_version` and immutable replay inputs (`provider_request_params_json`, `provider_request_hash`, `provider_request_schema_version`, `operation_key`, `provider_session_id`, `provider_idempotency_replay_deadline_at`, `provider_checkout_session_expires_at_upper_bound`)
       - commit
    2. **Provider resolution (outside DB transaction)**:
       - if `provider_session_id` exists, fetch provider session and canonical response
       - else if `now >= provider_idempotency_replay_deadline_at`, do not replay create:
         - if `now < provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`, run short fenced hold-materialization using the monotonic rule above (target hold expiry: `provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`) and then mark idempotency row `expired` with `failure_code = checkout_recovery_window_elapsed`
         - else mark idempotency row `expired` with `failure_code = checkout_recovery_window_elapsed` in a short fenced transaction (no blocking hold required because conservative unknown-session risk horizon already elapsed)
       - else if runtime SDK/API provenance is incompatible with persisted request provenance (`provider_api_version` mismatch or SDK major mismatch), do not replay create; run short fenced hold-materialization using the monotonic rule above (target hold expiry: `GREATEST(provider_checkout_session_expires_at_upper_bound, provider_idempotency_replay_deadline_at) + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`) and then mark idempotency row `failed` with `failure_code = checkout_replay_provenance_mismatch`
       - else replay `stripe.checkout.sessions.create` with the same `provider_idempotency_key` and exact persisted `provider_request_params_json`
    3. **Tx R2 (finalize; Tx B-equivalent lock order)**:
       - lock `billable_entities` row `FOR UPDATE`
       - lock `billing_subscriptions` rows for entity `FOR UPDATE`
       - lock idempotency row `FOR UPDATE` and assert expected `lease_version`
       - lock `billing_checkout_sessions` rows for entity `FOR UPDATE`
       - apply the same concurrent-subscription guard as Tx B
       - persist provider session/response
       - upsert `billing_checkout_sessions` by provider session state:
         - provider `open` -> local `open`
         - provider `complete` -> local `completed_pending_subscription`
         - provider `expired` -> local `expired`
       - only then set idempotency `status = succeeded`
       - commit
    4. if provider resolution returns deterministic non-retryable rejection, mark `failed` with `failure_code = checkout_provider_error`/`failure_reason` in a short fenced transaction; otherwise keep row `pending` for lease-based retries until an explicit terminal branch above applies
  - never hold DB row locks while calling provider APIs
  - stale pending rows that cannot be recovered within retry budget, or that pass `provider_idempotency_replay_deadline_at` with unknown `provider_session_id`, transition to `expired`; if conservative unknown-session risk horizon is still open, they must first materialize `recovery_verification_pending` hold until hold expiry/reconciliation.
- Provider outcome certainty contract (required):
  - definitive success (provider session payload with stable ID) -> continue Tx B / Tx R2 finalize path.
  - deterministic non-retryable provider rejection (for example validation/business rejection proving no session object was created) -> short fenced transaction marks idempotency `failed` with `failure_code = checkout_provider_error`, persists `failure_reason`, and returns API error from persisted code.
  - indeterminate provider outcome (timeout/reset, SDK retry exhaustion without definitive provider response, 5xx/429, interruption after request dispatch) -> keep idempotency row `pending`; do not mark `failed`/`expired` in synchronous flow; surface `request_in_progress`/`checkout_in_progress` until recovery resolves.
  - no path may clear request-level pending protection without either:
    - persisted provider session/response followed by checkout-session materialization, or
    - persisted blocking recovery hold where unknown-outcome policy requires it.
- Failure-code contract (required):
  - persisted `failure_code` values are canonical API-facing codes in Phase 1
  - required codes:
    - `request_in_progress`
    - `checkout_in_progress`
    - `checkout_session_open`
    - `checkout_completion_pending`
    - `checkout_recovery_verification_pending`
    - `subscription_exists_use_portal`
    - `checkout_recovery_window_elapsed`
    - `checkout_replay_provenance_mismatch`
    - `checkout_provider_error`
    - `idempotency_conflict`
  - mapping examples:
    - `failure_code = checkout_recovery_window_elapsed` -> API `409 checkout_recovery_window_elapsed`
    - `failure_code = checkout_replay_provenance_mismatch` -> API `409 checkout_replay_provenance_mismatch`
    - `failure_code = subscription_exists_use_portal` -> API `409 subscription_exists_use_portal`
    - `failure_code = checkout_provider_error` -> API `502 checkout_provider_error`
- Do not require provider-side "lookup by idempotency key" support.
  - optional provider optimization: `findByOperationKey(operation_key)` if provider supports metadata/correlation lookup
  - mandatory provider capability: deterministic idempotent replay on repeated create calls
- Expired idempotency rows are purged by retention job.

## 4) Checkout Orchestration (Race-Safe)

Checkout must run as a two-transaction flow to close race windows.

Mandatory entity-scoped lock order (all writers):
1. lock `billable_entities` row (`FOR UPDATE`)
2. lock `billing_subscriptions` rows for that entity (`FOR UPDATE`)
3. lock `billing_request_idempotency` row if present (`FOR UPDATE`)
4. lock `billing_checkout_sessions` rows for that entity (`FOR UPDATE`)
5. lock/insert `billing_subscription_remediations` row if present
6. lock/insert `billing_outbox_jobs` row if present

Webhook event-row lock (`billing_webhook_events`) is acquired before entity-scoped locks for dedupe; once entity is known, the above lock order is mandatory.
Short fenced recovery transactions that touch both `billing_request_idempotency` and `billing_checkout_sessions` are also entity-scoped writers and must use this same lock order.

Flow:
1. **Tx A (claim phase)**:
  - resolve workspace authorization
  - lock `billable_entities` row `FOR UPDATE`
  - lock current subscription rows for that entity `FOR UPDATE`
  - execute idempotency `claimOrReplay` (may return replay or conflict)
  - if claim is first-writer (not replay/conflict), lock `billing_checkout_sessions` rows for entity and enforce:
    - transition any `status = open` rows with `expires_at + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS <= now` to `expired` in the same transaction
    - transition any `status = recovery_verification_pending` rows with `expires_at <= now` to `abandoned` in the same transaction
    - no non-expired `status = open` checkout session exists (`expires_at > now - CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`)
    - no `status = completed_pending_subscription` checkout session exists
    - no non-expired `status = recovery_verification_pending` checkout session exists (`expires_at > now`)
    - else mark idempotency row `failed` and return:
      - `409 checkout_session_open` for blocking `open` row
      - `409 checkout_completion_pending` for blocking `completed_pending_subscription` row
      - `409 checkout_recovery_verification_pending` for blocking `recovery_verification_pending` row
  - verify no non-terminal `is_current = 1` subscription
  - resolve plan and deterministic Phase 1 sellable price
  - build and persist immutable `provider_request_params_json` + `provider_request_schema_version` + `provider_request_hash` for checkout
  - persist `provider_sdk_name` + `provider_sdk_version` + `provider_api_version` for request provenance
  - persist `provider_idempotency_replay_deadline_at` (Phase 1 Stripe: `created_at + 23h`)
  - require frozen checkout params to include explicit `expires_at = provider_request_frozen_at + 24h`
  - persist `provider_checkout_session_expires_at_upper_bound = frozenParams.expires_at` (no omission fallback)
  - commit
2. **Provider call (outside DB tx)**:
  - call `stripe.checkout.sessions.create(frozenParams, { idempotencyKey: provider_idempotency_key })`
  - include `operation_key`, `billable_entity_id`, and plan code/version in provider metadata
  - if provider result is indeterminate (timeout/reset/5xx/429 without definitive response), keep idempotency row `pending` and return `409 request_in_progress` (same key replay) / `409 checkout_in_progress` (different key) until recovery resolves
  - if provider returns deterministic non-retryable rejection, run short fenced transaction to mark idempotency `failed` with `failure_code = checkout_provider_error`, persist provider error context, and return `502 checkout_provider_error`
3. **Tx B (finalize phase)**:
  - lock `billable_entities` row `FOR UPDATE`
  - lock current subscription rows `FOR UPDATE`
  - lock idempotency row `FOR UPDATE`
  - lock `billing_checkout_sessions` rows for entity `FOR UPDATE`
  - assert expected idempotency `lease_version` before final mutation
  - re-check that no non-terminal `is_current = 1` subscription was created concurrently
  - if concurrent subscription now exists:
    - mark idempotency row `failed` with `failure_code = subscription_exists_use_portal`
    - persist or upsert checkout-session row as `abandoned` for audit/correlation
    - enqueue outbox job `expire_checkout_session` (if provider supports expiry API) using deterministic dedupe key
    - return `409 subscription_exists_use_portal`
  - persist provider session/response
  - upsert `billing_checkout_sessions` row from provider session state:
    - provider `open` -> local `open`
    - provider `complete` -> local `completed_pending_subscription`
    - provider `expired` -> local `expired`
    - persist `operation_key`, `provider_customer_id`, and session correlation metadata
  - set idempotency status `succeeded`
  - commit

If process crashes between provider call and Tx B, recovery logic in Section 3 resolves via deterministic SDK replay using stored `provider_request_params_json`.
Recovery is not allowed to mark checkout idempotency `succeeded` until the matching blocking checkout-session row has been persisted.
Recovery finalization must reacquire locks in the same entity-scoped order as Tx B (`billable_entities` -> `billing_subscriptions` -> `billing_request_idempotency` -> `billing_checkout_sessions`).

## 5) Service Contracts

### 5.1 `BillingPolicyService`

- `resolveBillableEntityForReadRequest(requestContext)`
- `resolveBillableEntityForWriteRequest(requestContext)`
  - explicit-or-singleton rule
  - rejects ambiguous selection (`409`)
  - rejects unauthorized workspace (`403`)
  - does not use `lastActiveWorkspace`
  - does not trust `x-surface-id` for authorization

### 5.2 `BillingPricingService`

- `resolvePhase1SellablePrice({ planId, provider })`
  - must return exactly one active licensed recurring base component
  - returned row currency must equal deployment `BILLING_CURRENCY`
  - otherwise fail closed (`409` config error) and alert

### 5.3 `BillingService`

- `ensureBillableEntity({ workspaceId, ownerUserId })`
- `listPlans({ billableEntityId })`
- `getSnapshot({ billableEntityId })`
- `createPortalSession(...)`
- `createPaymentLink(...)` (idempotent one-off link creation; supports catalog price IDs and ad-hoc amount inputs)

### 5.4 `BillingCheckoutOrchestrator`

- `startCheckout(...)` (Tx A + provider call + Tx B)
- `recoverCheckoutFromPending(...)` (Tx R1 lease acquire + provider resolution outside DB transaction + Tx R2 finalize)
- `finalizeRecoveredCheckout(...)` (must execute Tx B-equivalent finalize path, including checkout-session upsert before idempotency success)
- `buildFrozenStripeCheckoutSessionParams(...)`

### 5.5 `BillingCheckoutSessionService`

- `getBlockingCheckoutSession({ billableEntityId })`
- `upsertBlockingCheckoutSession({ billableEntityId, provider, providerCheckoutSessionId, idempotencyRowId, operationKey, providerCustomerId, checkoutUrl, expiresAt, status })`
- `markCheckoutSessionCompletedPendingSubscription({ providerCheckoutSessionId, operationKey, providerSubscriptionId, providerEventCreatedAt })`
- `markCheckoutSessionReconciled({ providerCheckoutSessionId, providerSubscriptionId, providerEventCreatedAt })`
- `markCheckoutSessionRecoveryVerificationPending({ operationKey, idempotencyRowId, holdExpiresAt, providerEventCreatedAt })` (must enforce monotonic no-regression rules)
- `markCheckoutSessionExpiredOrAbandoned({ providerCheckoutSessionId, reason, providerEventCreatedAt })`
- `assertCheckoutSessionCorrelation({ providerCheckoutSessionId, operationKey, billableEntityId, providerCustomerId })`

### 5.6 `BillingIdempotencyService`

- `claimOrReplay({ action, billableEntityId, clientIdempotencyKey, requestFingerprintHash, normalizedRequestJson })`
- `recoverPendingRequest({ idempotencyRowId, leaseVersion })`
- `expireStalePendingRequests({ olderThanSeconds })`
- `assertProviderRequestHashStable({ idempotencyRowId, candidateProviderRequestHash })`
- `assertLeaseVersion({ idempotencyRowId, leaseVersion })`
- `assertProviderReplayWindowOpen({ idempotencyRowId, now })`
- `assertReplayProvenanceCompatible({ idempotencyRowId, runtimeProviderSdkVersion, runtimeProviderApiVersion })`

### 5.7 `StripeSdkService` (Phase 1)

- `getClient()`:
  - initializes official `stripe` SDK with explicit `apiVersion`, `maxNetworkRetries`, and `timeout`
  - enforces single initialization path and shared config
- `createCheckoutSession({ params, idempotencyKey })`:
  - calls `stripe.checkout.sessions.create(params, { idempotencyKey })`
- `createBillingPortalSession({ params, idempotencyKey })`:
  - calls `stripe.billingPortal.sessions.create(params, { idempotencyKey })`
- `createPaymentLink({ params, idempotencyKey })`:
  - calls `stripe.paymentLinks.create(params, { idempotencyKey })`
- `createPrice({ params, idempotencyKey })`:
  - calls `stripe.prices.create(params, { idempotencyKey })` for ad-hoc payment-link line items
- `verifyWebhookEvent({ rawBody, signatureHeader, endpointSecret })`:
  - calls `stripe.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret)` before parsing/dispatch
- `getSdkProvenance()`:
  - returns `{ providerSdkName, providerSdkVersion, providerApiVersion }` for persistence on frozen requests

### 5.8 `BillingWebhookService`

- `processProviderEvent({ provider, rawBody, signatureHeader })`
- verifies signature before parsing
- routes each event type through an explicit ownership matrix
- performs transactional aggregate updates only
- enqueues side effects to outbox/remediation workers

### 5.9 `BillingOutboxWorkerService`

- `leaseNextJob({ workerId })` (increments and returns `lease_version`)
- `executeJob({ jobId, leaseVersion })` (must assert row `lease_version` matches)
- `retryOrDeadLetter({ jobId, leaseVersion, error })` (must assert row `lease_version` matches)
- `runExpireCheckoutSession({ provider, providerSessionId })`

### 5.10 `BillingRemediationWorkerService`

- `leaseNextRemediation({ workerId })` (increments and returns `lease_version`)
- `runCancelDuplicateSubscription({ remediationId, leaseVersion })` (must assert row `lease_version` matches)
- `retryOrDeadLetterRemediation({ remediationId, leaseVersion, error })`

### 5.11 `BillingReconciliationService`

- `runScope({ provider, scope, runnerId })`
- acquires/renews run lease via `billing_reconciliation_runs.active_run_key`
- increments and validates `lease_version` fencing token on acquire/renew
- detects and repairs drift transactionally

## 6) API Contracts

1. `GET /api/billing/plans`
  - auth: required
  - workspace policy: optional (selector-first via `x-workspace-slug` or `x-billable-entity-id`)
2. `GET /api/billing/subscription`
  - auth: required
  - workspace policy: optional (selector-first via `x-workspace-slug` or `x-billable-entity-id`)
3. `POST /api/billing/checkout`
  - auth: required
  - workspace policy: optional (selector-first via `x-workspace-slug` or `x-billable-entity-id`)
  - write authorization is resolved in billing policy service:
    - workspace entities require `workspace.billing.manage`
    - owner-scoped user entities require caller user id == entity owner user id
  - requires `Idempotency-Key`
  - response behavior:
    - success: created session payload or deterministic replay payload
    - `409 subscription_exists_use_portal` if current subscription exists (including concurrent-create detection)
    - `409 checkout_session_open` if a non-expired open checkout session already exists for the entity (return existing `provider_checkout_session_id`/`checkout_url` when safe)
    - `409 checkout_completion_pending` if a checkout session already completed but authoritative subscription projection is still pending
    - `409 checkout_recovery_verification_pending` if checkout is temporarily blocked because prior recovery outcome is still unknown (for example replay-window elapsed before conservative session-risk horizon or Stripe SDK/API provenance mismatch)
    - `409 checkout_in_progress` if another key has checkout `pending` for entity
    - `409 request_in_progress` if same key is still `pending`
    - `409 checkout_recovery_window_elapsed` if pending recovery can no longer safely replay provider create because the provider idempotency replay window elapsed
    - `409 checkout_replay_provenance_mismatch` if pending recovery cannot safely replay because runtime Stripe SDK/API provenance is incompatible with the frozen request provenance
    - `502 checkout_provider_error` if provider create/fetch fails deterministically with non-retryable rejection
  - error envelope contract:
    - API code/message must be derived from canonical persisted `failure_code` values (no ad hoc remapping)
    - if idempotency row is `failed` or `expired`, return the row's `failure_code` as the API error `code`
4. `POST /api/billing/portal`
  - auth: required
  - workspace policy: optional (selector-first via `x-workspace-slug` or `x-billable-entity-id`)
  - write authorization uses the same billing policy rules as checkout
  - requires `Idempotency-Key`
5. `POST /api/billing/payment-links`
  - auth: required
  - workspace policy: optional (selector-first via `x-workspace-slug` or `x-billable-entity-id`)
  - write authorization uses the same billing policy rules as checkout
  - requires `Idempotency-Key`
  - supports both catalog price IDs and ad-hoc one-off amount line items
  - one-off payment links must set provider invoice-creation options so paid one-off purchases project into `billing_invoices`
6. `POST /api/billing/webhooks/stripe`
  - auth: public
  - csrfProtection: false
  - raw request bytes required
  - enforce max payload size (for example 256KB) before signature verify/parse

Path validation for `successPath`, `cancelPath`, `returnPath`:
- must start with `/`
- must not start with `//`
- must not include protocol/host
- normalize with the same guard pattern used by auth `returnTo` path validation

## 7) Webhook Processing and Raw-Body Plumbing

Implementation requirements:
- Register route/plugin support so webhook handler receives exact raw bytes as `Buffer`.
- If raw bytes are unavailable, fail closed (`400`) and do not process event.
- Signature verification must run through `stripe.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret)` before JSON parsing.
- Required Phase 1 events include:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

Event ownership matrix (required):
- `checkout.session.completed`:
  - authoritative for checkout-session lifecycle/correlation (`billing_checkout_sessions.status` progression, `provider_checkout_session_id`, `provider_subscription_id`, checkout metadata, customer link validation)
  - must verify and persist session ownership correlation (`operation_key`, `billable_entity_id`, `provider_customer_id`) before state mutation
  - must enforce monotonic no-regression transitions (never move `completed_reconciled` back to `completed_pending_subscription`)
  - must not directly set subscription lifecycle fields (`status`, `is_current`)
- `checkout.session.expired`:
  - authoritative for checkout-session lifecycle cleanup (`billing_checkout_sessions.status -> expired`, pending idempotency expiration/cleanup path)
  - must not mutate subscription lifecycle state
- `customer.subscription.created|updated|deleted`:
  - authoritative for `billing_subscriptions` and `billing_subscription_items`
  - responsible for `is_current` transitions under status invariants
  - when correlated checkout session exists in `completed_pending_subscription`, transition it to `completed_reconciled` in the same transaction after authoritative subscription projection
- `invoice.paid|invoice.payment_failed`:
  - authoritative for `billing_invoices`/`billing_payments`
  - must not directly mutate `billing_subscriptions.is_current`

Processing sequence:
1. verify payload size, then call `stripe.webhooks.constructEvent` with raw bytes and signature
2. upsert/load `billing_webhook_events` by `(provider, provider_event_id)`
3. lock event row `FOR UPDATE`
4. if already processed, return success
5. resolve affected billable entity and lock `billable_entities` row `FOR UPDATE`
6. lock target aggregate rows `FOR UPDATE` using entity-scoped lock order
7. route event through ownership matrix and determine touched aggregate(s)
8. for `checkout.session.*`, enforce correlation checks against persisted `operation_key`/entity/customer linkage (mismatch => fail closed, alert, no state mutation)
9. enforce ordering using `provider_created_at` vs `last_provider_event_created_at` for touched aggregate(s)
10. same-timestamp conflicts reconcile by provider object semantics; use provider fetch fallback
11. apply aggregate state updates in transaction:
   - for `checkout.session.completed`, upsert missing session row by `operation_key` (if Tx B never completed); if existing status is `open` or `recovery_verification_pending`, advance to `completed_pending_subscription`; if existing status is `completed_reconciled`, `expired`, or `abandoned`, keep existing status (no regression)
   - for correlated `customer.subscription.*`, transition linked session `completed_pending_subscription -> completed_reconciled`
12. if duplicate active subscriptions detected, choose canonical deterministically:
   - prefer the single non-terminal row already marked `is_current = 1`
   - otherwise choose earliest persisted `provider_subscription_created_at`
   - if a candidate row lacks `provider_subscription_created_at`, fetch authoritative subscription object and persist it before selection
   - tie-break with lexical `provider_subscription_id`
   - persist `canonical_provider_subscription_id` + `selection_algorithm_version` in remediation rows
   - enqueue cancel jobs for non-canonical active subscriptions with deterministic dedupe keys
13. if event implies stale/orphan checkout session, enqueue `expire_checkout_session` or cleanup/audit job
14. mark webhook event `processed` and commit
15. on failure, mark failed with error and return non-2xx for provider retry

Important:
- Do not call provider cancellation APIs inside webhook DB transaction.
- Provider-side remediation executes asynchronously through outbox/remediation workers with dedicated idempotency keys.

Phase 1 webhook-updated tables:
- `billing_customers`
- `billing_subscriptions`
- `billing_subscription_items`
- `billing_invoices`
- `billing_payments`
- `billing_checkout_sessions`

Payment methods are not synchronized in Phase 1.

## 8) Scheduled Reconciliation and Drift Repair

- Reconciliation is required in Phase 1 (webhooks are primary, reconciliation is safety net).
- Acquire a per-`(provider, scope)` active run lease before each run.
  - if active non-stale run exists: skip
  - if lease is stale: safely take over and continue
  - on acquire/renew, increment `lease_version`; all checkpoint and finalization writes must assert matching `lease_version`
  - if fencing check fails, worker must stop without applying further mutations
- Idempotency recovery and outbox/remediation workers must enforce per-row `lease_version` fencing on execute/finalize transitions.
- Jobs:
  - fast loop every 15 minutes: reconcile entities with recent pending idempotency rows or failed webhook events
  - baseline loop every 6 hours: reconcile all entities with `is_current = 1` subscriptions
  - checkout-session loop every 30 minutes: reconcile `billing_checkout_sessions.status = open` rows near/after `expires_at + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`
  - recovery-verification loop every 10 minutes: reconcile `billing_checkout_sessions.status = recovery_verification_pending` rows and clear hold only after deterministic verification or hold expiry
  - checkout-completion loop every 10 minutes: reconcile `billing_checkout_sessions.status = completed_pending_subscription` older than completion grace SLA (for example 5 minutes)
  - invoice/payment loop daily: reconcile invoices/payments updated in last 30 days
- Drift detection sources:
  - provider subscription/customer/invoice/payment fetches
  - local aggregates and last processed webhook timestamps
- checkout-session repairs must enforce the same monotonic transition matrix from Section 2.15 (no regression to more-blocking states).
- Repair policy:
  1. provider object exists but local row missing: backfill local rows and link to entity/customer
  2. local current subscription is non-active at provider: mark ended and clear `is_current` transactionally
  3. multiple active provider subscriptions for entity: ensure `provider_subscription_created_at` is persisted for candidates, then run the same deterministic canonical selection from Section 7 and enqueue duplicate-subscription remediation rows with persisted canonical provider ID
  4. checkout session is locally `open` but provider says expired/completed:
     - if provider says `expired`, mark local session `expired` and clear blocking
     - if provider says `completed`, transition to `completed_pending_subscription` and keep blocking until authoritative subscription projection
  5. checkout session is `completed_pending_subscription` past grace SLA:
     - if provider has subscription/customer objects, backfill/project authoritative subscription state and transition session to `completed_reconciled`
     - if provider confirms no active follow-up subscription path, mark session `abandoned` and clear blocking key
  6. checkout session is `recovery_verification_pending`:
     - if provider session can be resolved deterministically (stored `provider_session_id` or provider correlation lookup by `operation_key`), transition to `open` / `completed_pending_subscription` / `expired` by authoritative provider state
     - if unresolved and hold `expires_at <= now`, mark session `abandoned` and clear blocking key
  7. invoice/payment amount or status mismatch: refresh local rows from provider state
- Any provider-side repair side effects are outbox jobs, not inline DB-transaction calls.
- Reconciliation failures raise alerts and remain retryable; no silent drift is allowed.

## 9) Entitlement Schema Registry (Required)

- `schema_version` is a strict key into a versioned schema registry stored in code/config.
- Phase 1 canonical schemas:
  - `entitlement.boolean.v1`
  - `entitlement.quota.v1`
  - `entitlement.string_list.v1`
- Example canonical payloads:

```json
{ "schema_version": "entitlement.boolean.v1", "value_json": { "enabled": true } }
```

```json
{ "schema_version": "entitlement.quota.v1", "value_json": { "limit": 25, "interval": "month", "enforcement": "hard" } }
```

- Validation behavior:
  - plan seed/publish write with invalid entitlement payload must fail transaction (`422` for API write, startup failure for invalid seed data)
  - snapshot/entitlement materialization must fail closed for invalid payload (do not grant entitlement), and emit alert with plan code/version
  - unknown `schema_version` is always invalid

## 10) Operational Guardrails

- Metrics/alerts required:
  - pending idempotency rows older than 2x lease TTL
  - pending checkout idempotency rows nearing or exceeding `provider_idempotency_replay_deadline_at`
  - idempotency lease-version fencing conflicts
  - provider-request hash mismatch attempts during recovery
  - Stripe SDK/API version drift from configured baseline
  - `checkout_replay_provenance_mismatch` failure-code rate
  - `checkout_provider_error` failure-code rate
  - `checkout_recovery_verification_pending` blocker count and age
  - repeated recovery failures by failure code
  - checkout-session correlation mismatch events (operation/entity/customer mismatch)
  - webhook failure rate and retry age
  - outbox dead-letter count
  - outbox lease-version fencing conflicts
  - remediation lease-version fencing conflicts
  - blocking checkout sessions older than expected SLA (`open`, `completed_pending_subscription`, and `recovery_verification_pending`)
  - orphan checkout-session cleanup attempts/failures
  - duplicate active subscription detections
  - canonical-selection fallback frequency (tie-break path usage)
  - reconciliation lease fencing conflicts
  - reconciliation drift count and repair failure count
- Logs must include stable correlation IDs:
  - `operation_key`
  - provider event ID
  - billable entity ID

## 11) Phases

1. Phase 1 (shipping)
  - workspace-backed billable entities with hard workspace FK
  - plans, checkout (new subscription only), portal, subscription snapshot
  - webhook idempotency/retry/ordering with explicit event ownership matrix + duplicate-subscription remediation enqueueing
  - explicit Stripe status mapping (`incomplete` is non-terminal and checkout-blocking)
  - official `stripe` Node SDK integration with explicit `apiVersion`, `maxNetworkRetries`, and `timeout`
  - strict idempotency model with tenant scope and deterministic replay recovery
  - provider idempotency replay-window guard (`provider_idempotency_replay_deadline_at`) to fail closed after safe replay horizon
  - recovery replay provenance guard (`provider_api_version` exact match + Stripe SDK major-version compatibility)
  - idempotency lease fencing (`lease_version`) to prevent stale recovery finalization
  - provider outcome-certainty contract: indeterminate provider results stay `pending` until recovery finalizes; deterministic provider rejections map to canonical `checkout_provider_error`
  - immutable Stripe SDK params replay guarantees (frozen `checkout.sessions.create` params snapshot + stable hash)
  - canonical `failure_code` taxonomy with deterministic persistence-to-API error mapping
  - one-blocking-checkout-session invariant (`open` + `completed_pending_subscription` + `recovery_verification_pending`) enforced by `billing_checkout_sessions`
  - unknown-outcome recovery holds remain blocking until conservative checkout-session lifetime upper bound elapses (`provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`)
  - checkout-session local expiry safety grace (`CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`) to avoid premature unblock near expiry boundaries
  - monotonic checkout-session lifecycle transitions (no regression to more-blocking states)
  - strict checkout-session correlation invariants (`operation_key`, provider/customer/subscription linkage)
  - race-safe two-transaction checkout orchestration
  - explicit lock ordering contract for all entity-scoped writers
  - deterministic duplicate-subscription canonical selection using persisted `provider_subscription_created_at`
  - scheduled provider reconciliation with run leases
  - reconciliation/outbox/remediation fencing token enforcement
  - immutable plan versions
  - single deployment billing currency enforcement
  - entitlement schema registry enforcement
  - outbox-based external side-effect execution
2. Phase 2 (merged program; includes former Phase 2 + Phase 3 scope)
  - 2.1 Enforcement foundation
    - `billing_payment_methods` table and sync events
    - usage counters and windowed limits
    - clean entitlement/limitation contract for app-runtime enforcement
  - 2.2 Billing visibility surfaces
    - console-level technical billing event explorer across all entities/workspaces
    - workspace-level user-friendly billing timeline/status views
    - filter/search by workspace, user, billable entity, `operation_key`, and provider event id
  - 2.3 Commercial model expansion
    - metered/hybrid component enablement
    - one-off billing flows
  - 2.4 Entity and provider expansion
    - optional non-workspace billable entities (schema expansion migration)
      - add billable-entity scope fields (`entity_type`, `entity_ref`) and nullable workspace/owner linkage
      - preserve workspace-backed compatibility while enabling owner-scoped user entities as first non-workspace type
      - billing API routes switch to optional workspace preselection so explicit `x-billable-entity-id` selectors can authorize non-workspace entities in billing policy
    - expanded analytics/provider parity

## 12) Test Requirements (Minimum)

- Surface spoofing test: billing authorization is not bypassed by forged `x-surface-id`.
- Billing-write workspace resolution: explicit, singleton, ambiguous (`409`), no `lastActiveWorkspace`.
- Idempotency:
  - same key + same fingerprint replays
  - same key + different fingerprint returns `409`
  - same idempotency key across different billable entities does not collide
  - same entity + different checkout idempotency keys in parallel yields one success and one `409 checkout_in_progress`
  - pending lease expiry triggers deterministic recovery without duplicate provider sessions
  - frozen Stripe checkout params always include explicit `expires_at = provider_request_frozen_at + 24h`
  - persisted `provider_checkout_session_expires_at_upper_bound` equals frozen params `expires_at`
  - recovery path without stored `provider_session_id` replays exact persisted `provider_request_params_json` via `stripe.checkout.sessions.create(..., { idempotencyKey })`
  - Stripe SDK replay uses the same persisted params hash and same idempotency key across retries
  - recovery executes as Tx R1 -> provider call (outside DB transaction) -> Tx R2 finalize
  - recovery success path persists blocking `billing_checkout_sessions` row before idempotency transitions to `succeeded`
  - recovery that observes provider session already `expired` persists local session `expired` (non-blocking)
  - recovery with unknown `provider_session_id` after `provider_idempotency_replay_deadline_at` but before `provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS` fails closed (`expired` / `checkout_recovery_window_elapsed`) without issuing provider create replay, and materializes `billing_checkout_sessions.status = recovery_verification_pending` before clearing request-level pending state
  - recovery with unknown `provider_session_id` after both `provider_idempotency_replay_deadline_at` and `provider_checkout_session_expires_at_upper_bound + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS` fails closed (`expired` / `checkout_recovery_window_elapsed`) without issuing provider create replay, and does not require a blocking hold
  - recovery with SDK/API provenance mismatch fails closed (`failed` / `checkout_replay_provenance_mismatch`) without issuing provider create replay, and materializes `billing_checkout_sessions.status = recovery_verification_pending` before clearing request-level pending state
  - hold-materialization paths never regress correlated `billing_checkout_sessions` from non-blocking states (`completed_reconciled`, `expired`, `abandoned`) back into `recovery_verification_pending`
  - hold-materialization paths preserve correlated blocking states (`open`, `completed_pending_subscription`) rather than rewriting them to `recovery_verification_pending`
  - indeterminate provider create outcome in synchronous checkout path (timeout/reset/5xx/429 without definitive response) leaves idempotency row `pending` and returns in-progress semantics until recovery resolves
  - deterministic non-retryable provider rejection persists canonical `failure_code = checkout_provider_error`, and API surfaces `502 checkout_provider_error`
  - `recovery_verification_pending` hold expiry uses `GREATEST(provider_checkout_session_expires_at_upper_bound, provider_idempotency_replay_deadline_at) + CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`
  - recovery expiration persists canonical `failure_code = checkout_recovery_window_elapsed`, and API response surfaces the same `code`
  - stale idempotency recovery actor cannot finalize after `lease_version` changes
  - provider-request hash mismatch is rejected/fails closed
  - Stripe SDK checkout create calls always pass per-request `{ idempotencyKey: provider_idempotency_key }`
- Checkout race tests:
  - concurrent subscription activation between Tx A and Tx B returns `409 subscription_exists_use_portal`
  - no duplicate provider subscription is created from that race
  - crash-after-provider-call recovery path still blocks a second checkout attempt until the recovered session resolves (`checkout_session_open` or `checkout_completion_pending`)
  - second checkout attempt with new idempotency key while an open checkout session exists returns `409 checkout_session_open`
  - an `open` checkout session with `expires_at` in the recent past remains blocking during `CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS`, then transitions to `expired`
  - second checkout attempt while prior session is `completed_pending_subscription` returns `409 checkout_completion_pending`
  - second checkout attempt while prior session is `recovery_verification_pending` returns `409 checkout_recovery_verification_pending`
  - recovery Tx R2 lock acquisition order matches Tx B and does not deadlock with concurrent webhook/subscription writers
  - concurrent writer flows obey entity lock order without deadlocks
- Pricing determinism tests:
  - Phase 1 seed with multiple active sellable price rows for same `(plan, provider)` fails
  - checkout fails closed when sellable price cannot be resolved uniquely
  - checkout fails when resolved sellable row currency does not match deployment `BILLING_CURRENCY`
- Subscription invariants:
  - `incomplete` subscription status can remain checkout-blocking (`is_current = 1`) until transition to terminal status or activation
  - terminal status cannot remain `is_current = 1`
  - atomic current-subscription flips preserve uniqueness
- Webhook tests:
  - signature verification from exact raw bytes via `stripe.webhooks.constructEvent`
  - payload-size guard rejects oversize payloads
  - dedupe/retry/order handling
  - event ownership matrix enforcement (`checkout.session.*` does not directly mutate subscription lifecycle)
  - `checkout.session.completed` transitions session to `completed_pending_subscription` only from `open` or `recovery_verification_pending`; correlated `customer.subscription.*` transitions it to `completed_reconciled`
  - out-of-order `checkout.session.completed` after `completed_reconciled` does not regress session state
  - metadata correlation mismatch on `checkout.session.*` fails closed and alerts without aggregate mutation
  - duplicate active subscription path writes remediation/outbox job but does not call provider inline
  - duplicate canonical selector is deterministic across retries/reconciliation using persisted `provider_subscription_created_at`
  - selector backfills missing `provider_subscription_created_at` before choosing canonical subscription
  - `checkout.session.expired` is handled idempotently
- Stripe SDK integration tests:
  - Stripe client initialization requires explicit `apiVersion`, `maxNetworkRetries`, and `timeout`
  - frozen request provenance (`provider_sdk_name`, `provider_sdk_version`, `provider_api_version`) is persisted on first-writer checkout path
  - recovery replay enforces provenance compatibility (`provider_api_version` exact match and SDK major-version compatibility) before issuing create replay
- Outbox/remediation worker tests:
  - lease + retry behavior is idempotent
  - stale worker cannot finalize row after `lease_version` changes
  - dead-letter behavior after retry budget is exhausted
  - dedupe uniqueness is enforced per `(job_type, dedupe_key)`
  - concurrent-subscription path enqueues session-expire cleanup job deterministically
- Reconciliation tests:
  - single active run lease per `(provider, scope)`
  - stale lease takeover works safely
  - stale runner cannot write after lease-version fencing mismatch
  - missed-webhook drift is repaired for subscription/invoice states
  - stale `billing_checkout_sessions.status = open` rows are reconciled to `expired`/`completed` without manual intervention
  - stale `billing_checkout_sessions.status = completed_pending_subscription` rows are reconciled to `completed_reconciled` or `abandoned` deterministically
  - stale `billing_checkout_sessions.status = recovery_verification_pending` rows are reconciled to provider-backed state or `abandoned` after hold expiry
- Schema tests:
  - any FK defined with `ON DELETE SET NULL` is nullable in DDL (`billing_checkout_sessions.idempotency_row_id` in Phase 1)
- Plan immutability and entitlement schema-version validation (unknown version rejection + invalid payload fail-closed behavior).
