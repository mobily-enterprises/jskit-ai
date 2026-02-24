# Billable Data Tables

This document describes the current billing-related data tables in the live MySQL database (`material-app`) as queried from `information_schema`, not reconstructed from migrations.

Notes:
- Field order matches the current live schema.
- Some columns that are logically JSON are reported by this server as `longtext` (common on MariaDB / JSON-alias setups).
- Generated columns are marked explicitly.

## Tables Covered

- `billable_entities`
- `billing_checkout_sessions`
- `billing_customers`
- `billing_events`
- `billing_payment_methods`
- `billing_plan_assignment_provider_details`
- `billing_plan_assignments`
- `billing_plans`
- `billing_purchases`
- `billing_request_idempotency`

## `billable_entities`

General:
- Canonical table for anything that can be billed.
- A workspace is the primary case today, but the schema also supports `user`, `organization`, and `external` billable scopes.

Important fields:
- `entity_type`: what kind of billable thing this row represents.
- `entity_ref`: reference key for non-workspace scopes or alternate identifiers.
- `workspace_id`: linked workspace for workspace-backed billing.
- `status`: active/inactive billing status.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal primary key for the billable entity.
- `entity_type` (`enum('workspace','user','organization','external')`, not null, default `workspace`): Type of billable entity.
- `entity_ref` (`varchar(191)`, nullable): External/reference identifier for the entity.
- `workspace_id` (`bigint unsigned`, nullable): Workspace ID when this entity is workspace-backed.
- `owner_user_id` (`bigint unsigned`, nullable): Owning user ID (historically required for workspace billing, now nullable for broader scopes).
- `status` (`enum('active','inactive')`, not null, default `active`): Whether the billable entity is active for billing operations.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp (UTC).
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row last update timestamp (UTC).

## `billing_checkout_sessions`

General:
- Internal tracking/projection table for checkout flows and recovery/self-heal.
- This is not the purchase ledger; it tracks the lifecycle of a checkout attempt/session.

Important fields:
- `billable_entity_id`: which entity is attempting checkout.
- `status`: internal checkout lifecycle state.
- `operation_key`: correlation key used across billing services/events.
- `provider_checkout_session_id`: provider session ID (e.g. Stripe Checkout Session).
- `provider_subscription_id`: provider subscription created/linked by checkout.
- `idempotency_row_id`: link to request idempotency state.
- `active_checkout_block_key`: generated column used to enforce only one blocking checkout at a time.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal checkout-session row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity this checkout flow belongs to.
- `provider` (`varchar(32)`, not null): Billing provider name (for example `stripe`).
- `provider_checkout_session_id` (`varchar(191)`, nullable): Provider checkout session ID; can be null before provider creation succeeds.
- `idempotency_row_id` (`bigint unsigned`, nullable): FK to the originating `billing_request_idempotency` row.
- `operation_key` (`varchar(64)`, not null): Internal correlation key for tracing the operation end-to-end.
- `provider_customer_id` (`varchar(191)`, nullable): Provider customer ID associated with the session.
- `provider_subscription_id` (`varchar(191)`, nullable): Provider subscription ID associated with or created by the checkout.
- `status` (`enum('open','completed_pending_subscription','recovery_verification_pending','completed_reconciled','expired','abandoned')`, not null): Internal checkout state.
- `checkout_url` (`text`, nullable): Redirect URL for the provider checkout page.
- `expires_at` (`datetime(3)`, nullable): Session expiration time.
- `completed_at` (`datetime(3)`, nullable): When the checkout completed on the provider/user side.
- `last_provider_event_created_at` (`datetime(3)`, nullable): Timestamp of the latest provider event applied/seen for this session.
- `last_provider_event_id` (`varchar(191)`, nullable): ID of the latest provider event applied/seen.
- `metadata_json` (`longtext`, nullable): JSON metadata for diagnostics/correlation.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.
- `active_checkout_block_key` (`bigint unsigned`, nullable, STORED GENERATED): Generated as `billable_entity_id` for active/blocking statuses (`open`, `completed_pending_subscription`, `recovery_verification_pending`) and `NULL` otherwise; used for uniqueness enforcement.

## `billing_customers`

General:
- Maps a billable entity to a provider customer record (for example a Stripe Customer).
- One entity can have a provider customer mapping per provider.

Important fields:
- `billable_entity_id`: owner of the provider customer.
- `provider`: billing provider name.
- `provider_customer_id`: provider-side customer ID (unique per provider).
- `email`: provider customer email snapshot.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal billing-customer row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity that owns this provider customer record.
- `provider` (`varchar(32)`, not null): Billing provider name.
- `provider_customer_id` (`varchar(191)`, not null): Provider customer ID.
- `email` (`varchar(320)`, nullable): Email address snapshot associated with the provider customer.
- `metadata_json` (`longtext`, nullable): JSON metadata for provider sync details and internal annotations.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.

## `billing_events`

General:
- Unified billing audit/event stream used for observability, tracing, and recovery.
- Includes webhook events and internal billing events such as plan changes.
- Not a customer purchase ledger.

Important fields:
- `event_type`: broad category (for example `webhook`, `plan_change`).
- `event_name`: specific subtype/name.
- `status`: processing/result status (semantics depend on event type).
- `provider_event_id`: provider event identifier for dedupe/tracing.
- `operation_key`: internal operation correlation key.
- `payload_json`: event payload (shape varies by type/provider).
- `occurred_at`: canonical timestamp used for event ordering.
- `webhook_dedupe_key`: generated webhook dedupe key (`provider:provider_event_id`).

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal event row ID.
- `event_type` (`varchar(64)`, not null): Broad event category.
- `event_name` (`varchar(120)`, nullable): Specific event name/subtype.
- `billable_entity_id` (`bigint unsigned`, nullable): Related billable entity, if applicable.
- `workspace_id` (`bigint unsigned`, nullable): Related workspace, if applicable.
- `user_id` (`bigint unsigned`, nullable): Related user (actor/subject), if applicable.
- `billing_customer_id` (`bigint unsigned`, nullable): Related billing customer mapping, if applicable.
- `provider` (`varchar(32)`, nullable): Provider associated with the event.
- `provider_event_id` (`varchar(191)`, nullable): Provider event ID (especially for webhook events).
- `operation_key` (`varchar(64)`, nullable): Internal correlation key tying the event back to a billing operation.
- `status` (`varchar(64)`, nullable): Processing or business status for the event.
- `from_plan_id` (`bigint unsigned`, nullable): Source plan ID in plan-change events.
- `to_plan_id` (`bigint unsigned`, nullable): Target plan ID in plan-change events.
- `effective_at` (`datetime(3)`, nullable): Business-effective time for the event (commonly plan changes).
- `provider_created_at` (`datetime(3)`, nullable): Provider-reported creation timestamp.
- `received_at` (`datetime(3)`, nullable): When the system received the event.
- `processing_started_at` (`datetime(3)`, nullable): When processing of the event started.
- `processed_at` (`datetime(3)`, nullable): When event handling completed. This indicates processing completion, not necessarily payment confirmation.
- `last_failed_at` (`datetime(3)`, nullable): Most recent processing failure timestamp.
- `attempt_count` (`int unsigned`, not null, default `0`): Number of processing attempts made.
- `payload_json` (`longtext`, nullable): Event payload JSON (varies by provider/event type).
- `metadata_json` (`longtext`, nullable): Internal metadata for diagnostics/recovery.
- `payload_retention_until` (`datetime(3)`, nullable): Retention deadline for payload cleanup/redaction.
- `error_text` (`text`, nullable): Last error encountered while processing the event.
- `occurred_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Canonical event timestamp used for ordering and queries.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.
- `webhook_dedupe_key` (`varchar(256)`, nullable, STORED GENERATED): Generated as `provider:provider_event_id` only when `event_type = 'webhook'`; used to dedupe duplicate webhook deliveries.

## `billing_payment_methods`

General:
- Provider payment methods synced to a billable entity/customer (for example cards).
- Stores user-facing card summary fields plus internal lifecycle state.

Important fields:
- `billable_entity_id`: owning billable entity.
- `billing_customer_id`: linked provider customer mapping row.
- `provider_payment_method_id`: provider-side payment method ID.
- `is_default`: default method flag.
- `status`: method lifecycle/usability status.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal payment-method row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity that owns the method.
- `billing_customer_id` (`bigint unsigned`, not null): FK to `billing_customers` for provider-customer context.
- `provider` (`varchar(32)`, not null): Billing provider name.
- `provider_payment_method_id` (`varchar(191)`, not null): Provider payment method ID.
- `type` (`varchar(64)`, not null): Payment method type (for example `card`).
- `brand` (`varchar(64)`, nullable): Card/network brand when applicable.
- `last4` (`varchar(4)`, nullable): Last four digits for card-like methods.
- `exp_month` (`int unsigned`, nullable): Expiration month for expiring methods.
- `exp_year` (`int unsigned`, nullable): Expiration year for expiring methods.
- `is_default` (`tinyint(1)`, not null, default `0`): Whether this is the default payment method in app state.
- `status` (`enum('active','detached','expired','disabled')`, not null, default `active`): Internal method lifecycle status.
- `last_provider_synced_at` (`datetime(3)`, nullable): Timestamp of the most recent provider sync.
- `metadata_json` (`longtext`, nullable): JSON metadata for provider-specific extras/sync data.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.

## `billing_plan_assignment_provider_details`

General:
- Thin typed provider-subscription details table keyed to a `billing_plan_assignments` row.
- Stores provider operational subscription fields without reintroducing a separate subscription-state source of truth.

Important fields:
- `billing_plan_assignment_id`: PK and FK to the assignment row (1:1/0:1 relationship).
- `provider_subscription_id`: provider subscription identifier.
- `provider_customer_id`: provider customer identifier.
- `provider_status`: provider-native subscription status snapshot.
- `current_period_end`: expiry/boundary time used for billing UI and scheduling behavior.
- `cancel_at_period_end`: provider flag for deferred cancellation.

Fields:
- `billing_plan_assignment_id` (`bigint unsigned`, PK, not null): FK to `billing_plan_assignments.id`; identifies the assignment this provider detail row belongs to.
- `provider` (`varchar(32)`, not null): Billing provider name.
- `provider_subscription_id` (`varchar(191)`, not null): Provider subscription ID.
- `provider_customer_id` (`varchar(191)`, nullable): Provider customer ID associated with the subscription.
- `provider_status` (`varchar(64)`, nullable): Provider-native subscription status snapshot.
- `provider_subscription_created_at` (`datetime(3)`, nullable): Provider-reported subscription creation time.
- `current_period_end` (`datetime(3)`, nullable): Provider-reported current billing period end.
- `trial_end` (`datetime(3)`, nullable): Provider-reported trial end time.
- `canceled_at` (`datetime(3)`, nullable): Timestamp when cancellation was recorded/requested at provider.
- `cancel_at_period_end` (`tinyint(1)`, not null, default `0`): Whether provider is configured to cancel at period boundary.
- `ended_at` (`datetime(3)`, nullable): Provider-reported subscription end timestamp.
- `last_provider_event_created_at` (`datetime(3)`, nullable): Timestamp of the latest provider event applied to this projection row.
- `last_provider_event_id` (`varchar(191)`, nullable): ID of the latest provider event applied to this projection row.
- `metadata_json` (`longtext`, nullable): JSON metadata for provider-specific extras and traceability/migration markers.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.

## `billing_plan_assignments`

General:
- Unified source of truth for plan state and plan history.
- Stores current, upcoming, past, and canceled assignments in one table.
- Replaces split current/scheduled/history sources for effective plan state.

Important fields:
- `billable_entity_id`: who the assignment applies to.
- `plan_id`: which plan is assigned.
- `source`: assignment source (`internal`, `promo`, `manual`).
- `status`: lifecycle (`current`, `upcoming`, `past`, `canceled`).
- `period_start_at` / `period_end_at`: assignment effective window.
- `current_assignment_entity_key` / `upcoming_assignment_entity_key`: generated keys used to enforce one current and one upcoming assignment max.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal plan assignment row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity this assignment belongs to.
- `plan_id` (`bigint unsigned`, not null): FK to `billing_plans.id` for the assigned plan.
- `source` (`enum('internal','promo','manual')`, not null, default `internal`): Why/how the assignment exists (normal system assignment, promo, or manual/scheduled/admin path).
- `period_start_at` (`datetime(3)`, not null): Effective start time of the assignment.
- `period_end_at` (`datetime(3)`, not null): Effective end time of the assignment (expected to be later than `period_start_at`).
- `status` (`enum('current','upcoming','past','canceled')`, not null): Assignment lifecycle status.
- `metadata_json` (`longtext`, nullable): JSON metadata for traceability, reasons, and migration/source annotations.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.
- `current_assignment_entity_key` (`bigint unsigned`, nullable, STORED GENERATED): Generated as `billable_entity_id` when `status = 'current'`, else `NULL`; supports uniqueness for current assignment per entity.
- `upcoming_assignment_entity_key` (`bigint unsigned`, nullable, STORED GENERATED): Generated as `billable_entity_id` when `status = 'upcoming'`, else `NULL`; supports uniqueness for upcoming assignment per entity.

## `billing_plans`

General:
- Billing plan catalog and core checkout price mapping.
- The simplified architecture stores the core checkout price directly on the plan row.

Important fields:
- `code`: stable plan identifier used by code/UI.
- `name`: display name.
- `checkout_provider_price_id`: provider price for the core plan subscription.
- `checkout_currency` and `checkout_unit_amount_minor`: displayed/charged plan amount.
- `checkout_interval` and `checkout_interval_count`: billing cadence (app expects monthly core plans).
- `is_active`: whether the plan is active/offerable.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal plan ID.
- `code` (`varchar(120)`, not null): Stable plan code.
- `name` (`varchar(160)`, not null): Human-readable plan name.
- `description` (`text`, nullable): Descriptive text for the plan.
- `applies_to` (`enum('workspace')`, not null, default `workspace`): Scope this plan applies to (currently workspace only).
- `checkout_provider` (`varchar(32)`, not null): Billing provider used for core checkout (for example `stripe`).
- `checkout_provider_price_id` (`varchar(191)`, not null): Provider price ID for the core subscription price.
- `checkout_provider_product_id` (`varchar(191)`, nullable): Provider product ID for the plan.
- `checkout_interval` (`enum('day','week','month','year')`, not null): Billing interval unit for the core price.
- `checkout_interval_count` (`int unsigned`, not null): Interval multiplier for the core price (for example `1` month).
- `checkout_currency` (`varchar(3)`, not null): ISO currency code.
- `checkout_unit_amount_minor` (`bigint unsigned`, not null): Core price amount in minor units (for example cents).
- `is_active` (`tinyint(1)`, not null, default `1`): Whether the plan is active/available.
- `metadata_json` (`longtext`, nullable): JSON metadata for plan flags/configuration annotations.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.

## `billing_purchases`

General:
- Customer-facing purchase ledger table (one row per confirmed purchase).
- This is the correct source for purchase history. `billing_events` remains audit/debug/recovery data.

Important fields:
- `purchase_kind`: purchase category/type.
- `status`: purchase status (currently used for confirmed purchases, future-friendly for refund states).
- `amount_minor` / `currency`: purchase amount.
- `dedupe_key`: idempotency/dedupe key to prevent duplicate confirmed purchase rows.
- `purchased_at`: business timestamp for purchase confirmation.
- `provider_*` IDs and `billing_event_id`: traceability and reconciliation.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal purchase ledger row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity the purchase belongs to.
- `workspace_id` (`bigint unsigned`, nullable): Workspace correlation/snapshot for filtering and display.
- `provider` (`varchar(32)`, not null): Billing provider name.
- `purchase_kind` (`varchar(64)`, not null): Category/type of purchase (for example one-off, top-up, subscription invoice).
- `status` (`varchar(32)`, not null, default `confirmed`): Purchase status.
- `amount_minor` (`bigint unsigned`, not null): Amount in minor units.
- `currency` (`varchar(3)`, not null): ISO currency code.
- `quantity` (`int unsigned`, nullable, default `1`): Quantity associated with the purchase, when meaningful.
- `operation_key` (`varchar(64)`, nullable): Internal operation correlation key.
- `provider_customer_id` (`varchar(191)`, nullable): Provider customer ID at purchase time.
- `provider_checkout_session_id` (`varchar(191)`, nullable): Provider checkout session ID related to the purchase.
- `provider_payment_id` (`varchar(191)`, nullable): Provider payment/charge/payment-intent identifier (integration-dependent mapping).
- `provider_invoice_id` (`varchar(191)`, nullable): Provider invoice ID when purchase is invoice-backed.
- `billing_event_id` (`bigint unsigned`, nullable): FK to `billing_events.id` for audit traceability.
- `display_name` (`varchar(255)`, nullable): Human-readable purchase description snapshot for UI display.
- `metadata_json` (`longtext`, nullable): JSON metadata for provider extras, itemization, and reconciliation context.
- `dedupe_key` (`varchar(256)`, not null): Canonical dedupe key used to ensure one row per confirmed purchase.
- `purchased_at` (`datetime(3)`, not null): Business timestamp when the purchase was confirmed/occurred.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.

## `billing_request_idempotency`

General:
- Idempotency, in-flight coordination, and recovery table for billing requests (checkout, portal, payment-link).
- Prevents duplicate request execution and supports retry/recovery/self-heal workflows.

Important fields:
- `action`: request type being deduped.
- `client_idempotency_key`: client-provided dedupe key.
- `request_fingerprint_hash` + `normalized_request_json`: canonical request identity and mismatch protection.
- `operation_key`: end-to-end billing operation correlation.
- `provider_idempotency_key`: idempotency key sent to provider.
- `status`: lifecycle of the idempotency row.
- lease fields (`pending_lease_expires_at`, `lease_owner`, `lease_version`): worker/process coordination.
- recovery fields (`recovery_attempt_count`, `last_recovery_attempt_at`): self-heal/recovery tracking.
- `active_checkout_pending_key`: generated uniqueness guard for one pending checkout per entity.

Fields:
- `id` (`bigint unsigned`, PK, auto-increment): Internal idempotency row ID.
- `billable_entity_id` (`bigint unsigned`, not null): Billable entity this request targets.
- `action` (`enum('checkout','portal','payment_link')`, not null): Billing action type being coordinated.
- `client_idempotency_key` (`varchar(191)`, not null): Client-supplied idempotency key.
- `request_fingerprint_hash` (`varchar(64)`, not null): Hash of the normalized request payload, used to detect key reuse with different parameters.
- `normalized_request_json` (`longtext`, not null): Canonical request payload snapshot used for hashing and replay safety.
- `operation_key` (`varchar(64)`, not null): Internal correlation key for tracing the operation.
- `provider_request_params_json` (`longtext`, nullable): Frozen provider request parameters snapshot.
- `provider_request_hash` (`varchar(64)`, nullable): Hash of frozen provider request parameters for reproducibility/debugging.
- `provider_request_schema_version` (`varchar(120)`, nullable): Version tag for provider request normalization/schema.
- `provider_sdk_name` (`varchar(64)`, nullable): Provider SDK name used to send the request.
- `provider_sdk_version` (`varchar(32)`, nullable): Provider SDK version used.
- `provider_api_version` (`varchar(32)`, nullable): Provider API version used.
- `provider_request_frozen_at` (`datetime(3)`, nullable): When provider request parameters were frozen for idempotent retries.
- `provider` (`varchar(32)`, not null, default `stripe`): Billing provider for this request.
- `provider_idempotency_key` (`varchar(191)`, not null): Idempotency key sent to the provider.
- `provider_idempotency_replay_deadline_at` (`datetime(3)`, nullable): Deadline after which provider replay guarantees may no longer apply.
- `provider_checkout_session_expires_at_upper_bound` (`datetime(3)`, nullable): Upper-bound checkout session expiry used for reconciliation/recovery timing.
- `provider_session_id` (`varchar(191)`, nullable): Provider session/object ID produced by the request (for example checkout session ID).
- `response_json` (`longtext`, nullable): Stored response/result payload for safe idempotent replay.
- `status` (`enum('pending','succeeded','failed','expired')`, not null, default `pending`): Lifecycle state of the idempotency row.
- `pending_lease_expires_at` (`datetime(3)`, nullable): Lease expiry for a pending/in-flight row.
- `pending_last_heartbeat_at` (`datetime(3)`, nullable): Last heartbeat timestamp from the worker/process holding the lease.
- `lease_owner` (`varchar(120)`, nullable): Identifier of the worker/process holding the lease.
- `lease_version` (`int unsigned`, not null, default `1`): Optimistic concurrency version for lease updates.
- `recovery_attempt_count` (`int unsigned`, not null, default `0`): Number of recovery/self-heal attempts made.
- `last_recovery_attempt_at` (`datetime(3)`, nullable): Timestamp of the most recent recovery attempt.
- `failure_code` (`varchar(96)`, nullable): Structured failure code for diagnostics.
- `failure_reason` (`text`, nullable): Human-readable failure reason/details.
- `expires_at` (`datetime(3)`, nullable): App-level expiration time for cleanup/retention.
- `created_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row creation timestamp.
- `updated_at` (`datetime(3)`, not null, default `utc_timestamp(3)`): Row update timestamp.
- `active_checkout_pending_key` (`bigint unsigned`, nullable, STORED GENERATED): Generated as `billable_entity_id` only when `action = 'checkout'` and `status = 'pending'`; used to enforce at most one pending checkout idempotency row per entity.

