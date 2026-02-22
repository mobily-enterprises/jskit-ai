# STRIPE Plan v22 Traceability Matrix

Generated: 2026-02-21
Plan Source: `STRIPE_PLAN.md` (v22 merged phase 2 program)

## Status Legend

| Status | Meaning |
| --- | --- |
| done | Implemented and wired in runtime |
| partial | Implemented in part; additional hardening/coverage may still be needed |
| deferred | Explicitly deferred (including tests per current instruction) |

## Module Boundary / Kernel Concentration

| Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Keep billing logic concentrated in one backend module | `server/modules/billing/*` (services, repository, orchestration, webhook projection, workers, reconciliation, schemas, constants) | done | Core billing kernel is concentrated in one directory. |
| Keep integration points small and explicit | `server/runtime/services.js`, `server/runtime/index.js`, `server/runtime/controllers.js`, `server/modules/api/routes.js`, `server.js`, `server/fastify/billingWebhookRawBody.plugin.js` | done | Non-billing files are thin wiring only. |

## 0) Phase 1 Scope Decisions (Locked)

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Workspace-only billable entity in Phase 1 | `migrations/20260221090000_create_billing_phase1_tables.cjs` (`billable_entities.workspace_id` FK), `server/modules/billing/policy.service.js` | done | No polymorphic entity type in Phase 1 schema. |
| Surface-agnostic routes, workspace+RBAC auth | `server/modules/billing/routes.js`, `server/modules/billing/policy.service.js` | done | Authorization tied to workspace and role permissions. |
| Billing writes must not use lastActiveWorkspace | `server/modules/billing/policy.service.js` | done | Explicit selector or singleton behavior only. |
| Checkout create-only for entities without current subscription | `server/modules/billing/checkoutOrchestrator.service.js` (`enforceNoCurrentSubscription`) | done | Checked in Tx A and Tx B-equivalent paths. |
| At most one in-flight checkout per entity | DB generated unique key `active_checkout_pending_key` + `claimOrReplay` in `server/modules/billing/idempotency.service.js` | done | Enforced by DB and service logic. |
| At most one blocking checkout session per entity | DB generated unique key `active_checkout_block_key` + `checkoutSession.service.js` transitions | done | Covers `open`, `completed_pending_subscription`, `recovery_verification_pending`. |
| Plan changes for existing subscriptions via portal | `server/modules/billing/service.js` (`createPortalSession` requires current subscription) | done | Checkout rejects with `subscription_exists_use_portal`. |
| Payment method sync Phase 2.1 only | No `billing_payment_methods` table/service | done | Intentionally excluded from Phase 1 runtime. |
| Stripe provider pluggable by interface boundary | `server/modules/billing/stripeSdk.service.js` + provider field persisted in schema | done | Phase 1 ships Stripe-only but provider logic is isolated behind module/service boundaries. |
| Use official Stripe SDK only | `server/modules/billing/stripeSdk.service.js` | done | Calls `stripe` SDK methods directly. |
| Stripe SDK init centralized with apiVersion/retries/timeout | `server/modules/billing/stripeSdk.service.js` (`getClient`) | done | Single initialization path. |
| Replay provenance guard (api version + SDK major) | `server/modules/billing/idempotency.service.js` (`assertReplayProvenanceCompatible`), `checkoutOrchestrator.service.js` recovery flow | done | Enforced before recovery replay create. |
| Unknown-outcome hold (`recovery_verification_pending`) before terminalizing when needed | `checkoutOrchestrator.service.js` (`materializeRecoveryVerificationHold`), `checkoutSession.service.js`, `reconciliation.service.js` | done | Monotonic hold handling present. |
| Hold horizon tied to session upper-bound + grace | `checkoutOrchestrator.service.js`, `reconciliation.service.js` | done | Uses persisted upper-bound and grace window. |
| Checkout frozen params must include explicit expires_at | `checkoutOrchestrator.service.js` (`buildFrozenStripeCheckoutSessionParams`) | done | Missing value fails closed. |
| Persist checkout session upper-bound from frozen params expires_at | `checkoutOrchestrator.service.js` (persist to idempotency row) | done | Stored as `provider_checkout_session_expires_at_upper_bound`. |
| Single deployment billing currency | `pricing.service.js` + env `BILLING_CURRENCY` | done | Checkout price resolver enforces currency match. |
| Webhook ownership matrix explicit | `webhook.service.js` + projection services | done | Event type to owner path is explicit. |
| Idempotency lease fencing via monotonic lease_version | `idempotency.service.js`, repository CAS update methods | done | Checked before finalization branches. |
| Checkout correlation persisted/enforced | Frozen metadata in checkout params + `webhookCheckoutProjection.service.js` correlation checks | done | Mismatch fails closed. |
| Checkout lifecycle transitions monotonic | `constants.js` transition matrix + `checkoutSession.service.js` | done | Non-regression enforced. |
| Recovery hold materialization monotonic | `checkoutSession.service.js` (`markCheckoutSessionRecoveryVerificationPending`) + orchestrator/reconciliation usage | done | Terminal states are not regressed. |
| Frozen provider request params hashable/canonical | `canonicalJson.js`, `checkoutOrchestrator.service.js`, `idempotency.service.js` | done | Canonical JSON + SHA256 hashes persisted/checked. |
| Failure codes canonical and API-facing | `constants.js`, `service.js`, `checkoutOrchestrator.service.js`, `idempotency.service.js` | done | Canonical codes surfaced in error details. |
| Replay deadline guard (23h for Stripe) | env + constants + checkout orchestrator | done | `provider_idempotency_replay_deadline_at` persisted and enforced. |
| Recovery finalization must write checkout session before idempotency succeeded | `checkoutOrchestrator.service.js` (`applyFinalizeTx`) | done | Checkout upsert precedes `markSucceeded`. |
| Recovery flow split Tx R1 / provider / Tx R2 | `idempotency.service.js` + `checkoutOrchestrator.service.js` | done | Provider calls are outside DB transactions. |
| Indeterminate provider outcomes remain pending | `checkoutOrchestrator.service.js` | done | Returns in-progress semantics without terminalizing. |

## 1) Trust and Authorization Model

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Do not trust `x-surface-id` for billing auth | `policy.service.js` workspace resolution ignores surface id | done | Uses user + workspace selector + role perms. |
| Authorization inputs are auth user + workspace + permission | `policy.service.js`, `routes.js` permission gates | done | Write paths require `workspace.billing.manage`. |
| Billing routes do not accept provider IDs from clients | `schema.js` request bodies only include plan/path fields | done | No `providerPriceId` etc accepted from client. |
| Explicit selector / singleton / ambiguous 409 behavior | `policy.service.js` | done | `BILLING_WORKSPACE_SELECTION_REQUIRED` on ambiguous cases. |

## 2) Data Model (MySQL Safe)

| Table / Rule | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `billable_entities` | migration + repository map/find/ensure methods | done | Unique workspace mapping enforced. |
| `billing_customers` | migration + `find/upsertCustomer` | done | Composite uniqueness and FK constraints present. |
| `billing_plans` | migration + `listPlans/findPlan*` | done | Immutable-version structure represented. |
| `billing_plan_prices` | migration + `findSellablePlanPricesForPlan/findPlanPriceByProviderPriceId` | done | Includes generated `phase1_sellable_price_key`. |
| `billing_entitlements` | migration + `listPlanEntitlementsForPlan` + schema registry validation path | done | Runtime validation applied when listing plans. |
| `billing_subscriptions` | migration + `findCurrent`, `upsertSubscription`, `clearCurrentSubscriptionFlags` | done | Current-subscription uniqueness and terminal clearing behavior implemented. |
| `billing_subscription_items` | migration + upsert/find/list methods | done | Provider item id uniqueness present. |
| `billing_invoices` | phase 1 + phase 2.3 migrations + upsert/find/list methods | done | Subscription-linked and one-off invoices are both supported via nullable `subscription_id` plus explicit invoice ownership (`billable_entity_id`, `billing_customer_id`). |
| `billing_payments` | migration + upsert/find/list methods | done | Payment projection and reconciliation support present. |
| `billing_webhook_events` | migration + insert/find/update/list failed methods | done | Dedupe key `(provider, provider_event_id)` enforced. |
| `billing_request_idempotency` | migration + full claim/replay/recovery/update methods | done | Includes lease/failure/provenance fields, generated active key, and action scope for `checkout`/`portal`/`payment_link`. |
| `billing_reconciliation_runs` | migration + acquire/update methods | done | Includes active-run uniqueness and lease fencing support. |
| `billing_subscription_remediations` | migration + upsert/lease/update methods | done | Duplicate remediation dedupe key enforced. |
| `billing_outbox_jobs` | migration + enqueue/lease/update methods | done | Deterministic dedupe key uniqueness enforced. |
| `billing_checkout_sessions` | migration + upsert/find/update/lock methods | done | Includes operation key, correlation fields, and active block key. |
| Nullability rule for FK with `ON DELETE SET NULL` | `billing_checkout_sessions.idempotency_row_id` and `billing_subscription_remediations.canonical_subscription_id` nullable in migration | done | Matches plan nullability constraint. |

## 3) Idempotency and Recovery Rules

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Billing writes require `Idempotency-Key` | `controller.js` (`requireIdempotencyKey`) | done | Enforced for checkout/portal/payment-link endpoints. |
| Claim/replay transactional behavior | `idempotency.service.js` (`claimOrReplay`) | done | Uses transactional row locking and canonical outcomes. |
| Same key different payload -> `idempotency_conflict` | `idempotency.service.js` | done | 409 code in error details. |
| Replay succeeded/failed/expired rows deterministically | `idempotency.service.js`, `service.js`, `checkoutOrchestrator.service.js` | done | Replays response/failure semantics. |
| Active pending lease -> in progress code | `idempotency.service.js` + orchestrator/service mapping | done | Returns `request_in_progress`/`checkout_in_progress`. |
| Freeze checkout params exactly once + hash/provenance | `checkoutOrchestrator.service.js` | done | Params, hash, schema version, SDK/API provenance persisted. |
| Explicit frozen `expires_at` + invariant fail-closed | `checkoutOrchestrator.service.js` | done | Throws if invalid/missing. |
| Persist replay deadline and session upper-bound | `checkoutOrchestrator.service.js` + idempotency row fields | done | Used by recovery paths. |
| Checkout pending concurrency guard across keys | `idempotency.service.js` + generated DB key | done | Prevents parallel pending checkout claims. |
| Checkout-session blocking guard by status windows | `checkoutSession.service.js` + orchestrator Tx A | done | Includes grace behavior. |
| Correlation metadata on create and verification on webhook/recovery | checkout params metadata + `webhookCheckoutProjection.service.js` | done | Correlation mismatch throws fail-closed. |
| Recovery Tx R1 lease acquire and version bump | `idempotency.service.js` (`recoverPendingRequest`) | done | Increments lease version and recovery counters. |
| Recovery provider resolution outside DB transaction | `checkoutOrchestrator.service.js` | done | No provider call under DB lock. |
| Replay forbidden after replay deadline (with hold logic) | `checkoutOrchestrator.service.js` + `reconciliation.service.js` | done | Expire or materialize/maintain holds based on horizon. |
| Replay provenance compatibility enforced | `idempotency.service.js` + orchestrator | done | API version exact + SDK major compatibility. |
| Tx R2 finalize lock order + lease assert | `checkoutOrchestrator.service.js` (`applyFinalizeTx`) | done | Enforces lock sequence and lease check. |
| Deterministic provider rejections -> terminal failed | `checkoutOrchestrator.service.js` | done | Maps to canonical `checkout_provider_error`. |
| Indeterminate provider results stay pending | `checkoutOrchestrator.service.js` | done | Returns in-progress API semantics. |
| Stale pending cleanup to expired | `idempotency.service.js` + `reconciliation.service.js` (`pending_recent`) | done | Includes fail-closed expiration logic. |
| Expired idempotency purge via retention | `server/domain/operations/services/retention.service.js`, `bin/retentionSweep.js`, `server/modules/billing/repository.js` | done | Billing terminal idempotency purge + webhook payload retention scrubbing are wired into retention sweep. |

## 4) Checkout Orchestration (Race Safe)

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Tx A + provider + Tx B architecture | `checkoutOrchestrator.service.js` | done | End-to-end implemented. |
| Global lock ordering for entity writers | `checkoutOrchestrator.service.js`, webhook projection services, `reconciliation.service.js` | done | Entity-scoped writers consistently lock in plan order (`billable_entities` -> `billing_subscriptions` -> `billing_request_idempotency` -> `billing_checkout_sessions`). |
| Tx A cleanup expired blocking sessions | `checkoutSession.service.js` (`cleanupExpiredBlockingSessions`) called from orchestrator | done | Applies grace and hold expiry transitions. |
| Tx A blocking checks by status | `checkoutOrchestrator.service.js` (`resolveFailureCodeForBlockingSession`) | done | Canonical codes returned. |
| Tx A current subscription guard | `checkoutOrchestrator.service.js` (`enforceNoCurrentSubscription`) | done | Prevents create-only rule violation. |
| Tx A deterministic plan/price resolution | `checkoutOrchestrator.service.js` + `pricing.service.js` | done | Fails closed on configuration invalidity. |
| Provider call outside transaction | `checkoutOrchestrator.service.js` | done | Stripe call happens between Tx A and Tx B. |
| Tx B concurrent subscription re-check and failover | `checkoutOrchestrator.service.js` (`applyFinalizeTx`) | done | Marks failed, writes abandoned session, enqueues expire outbox job. |
| Tx B session upsert from provider state | `checkoutOrchestrator.service.js` | done | Maps provider open/complete/expired to local state. |
| Tx B marks idempotency succeeded last | `checkoutOrchestrator.service.js` | done | Checkout session materialized first. |

## 5) Service Contracts

### 5.1 BillingPolicyService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `resolveBillableEntityForReadRequest` | `policy.service.js` | done | |
| `resolveBillableEntityForWriteRequest` | `policy.service.js` | done | Explicit selector/singleton + permission check. |
| No `lastActiveWorkspace`, no `x-surface-id` trust | `policy.service.js` | done | |

### 5.2 BillingPricingService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `resolvePhase1SellablePrice` | `pricing.service.js` | done | Resolves one deterministic plan-owned core recurring price in deployment currency. |

### 5.3 BillingService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `ensureBillableEntity` | `service.js` | done | |
| `listPlans` | `service.js` | done | Includes entitlement validation and returns each plan with its core price mapping. |
| `getSnapshot` | `service.js` | done | Returns customer/subscription/items/invoices/payments snapshot. |
| `createPortalSession` | `service.js` | done | Idempotent, deterministic, and replay-safe. |
| `createPaymentLink` | `service.js` | done | Idempotent one-off payment-link creation supports both catalog prices and ad-hoc amounts with replay-safe frozen provider params. |

### 5.4 BillingCheckoutOrchestrator

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `startCheckout` | `checkoutOrchestrator.service.js` | done | |
| `recoverCheckoutFromPending` | `checkoutOrchestrator.service.js` | done | |
| `finalizeRecoveredCheckout` | `checkoutOrchestrator.service.js` | done | Uses Tx B-equivalent finalize path. |
| `buildFrozenStripeCheckoutSessionParams` | `checkoutOrchestrator.service.js` | done | |

### 5.5 BillingCheckoutSessionService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `getBlockingCheckoutSession` | `checkoutSession.service.js` | done | |
| `upsertBlockingCheckoutSession` | `checkoutSession.service.js` | done | |
| `markCheckoutSessionCompletedPendingSubscription` | `checkoutSession.service.js` | done | |
| `markCheckoutSessionReconciled` | `checkoutSession.service.js` | done | Includes fallback by operation/subscription correlation. |
| `markCheckoutSessionRecoveryVerificationPending` | `checkoutSession.service.js` | done | Monotonic behavior enforced. |
| `markCheckoutSessionExpiredOrAbandoned` | `checkoutSession.service.js` | done | |
| `assertCheckoutSessionCorrelation` | `checkoutSession.service.js` | done | |

### 5.6 BillingIdempotencyService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `claimOrReplay` | `idempotency.service.js` | done | |
| `recoverPendingRequest` | `idempotency.service.js` | done | Signature includes lease owner + returns expected lease version. |
| `expireStalePendingRequests` | `idempotency.service.js` | done | |
| `assertProviderRequestHashStable` | `idempotency.service.js` | done | |
| `assertLeaseVersion` | `idempotency.service.js` | done | Supports transaction options. |
| `assertProviderReplayWindowOpen` | `idempotency.service.js` | done | |
| `assertReplayProvenanceCompatible` | `idempotency.service.js` | done | |

### 5.7 StripeSdkService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Central `getClient` with explicit config | `stripeSdk.service.js` | done | |
| `createCheckoutSession` | `stripeSdk.service.js` | done | |
| `createBillingPortalSession` | `stripeSdk.service.js` | done | |
| `createPaymentLink` | `stripeSdk.service.js` | done | |
| `createPrice` | `stripeSdk.service.js` | done | Used for ad-hoc payment-link line-item pricing. |
| `verifyWebhookEvent` | `stripeSdk.service.js` | done | Uses raw bytes and endpoint secret. |
| `getSdkProvenance` | `stripeSdk.service.js` | done | |

### 5.8 BillingWebhookService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `processProviderEvent` | `webhook.service.js` | done | Signature verify + required event filter + transactional processing. |

### 5.9 BillingOutboxWorkerService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `leaseNextJob` with fencing behavior | `outboxWorker.service.js` + repository CAS lease update | done | |
| `executeJob` with lease assertion | `outboxWorker.service.js` | done | |
| `retryOrDeadLetter` with lease assertion | `outboxWorker.service.js` | done | |
| `runExpireCheckoutSession` | `outboxWorker.service.js` | done | |

### 5.10 BillingRemediationWorkerService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `leaseNextRemediation` | `remediationWorker.service.js` + repository CAS | done | |
| `runCancelDuplicateSubscription` | `remediationWorker.service.js` | done | |
| `retryOrDeadLetterRemediation` | `remediationWorker.service.js` | done | |

### 5.11 BillingReconciliationService

| Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `runScope` with run lease | `reconciliation.service.js` + repository reconciliation lease methods | done | |
| Lease-version fencing on finalization | `reconciliation.service.js` + `updateReconciliationRunByLease` | done | |
| Drift detection/repair scopes | `reconciliation.service.js` | done | Includes checkout, pending, subscriptions, invoices scopes. |

## 6) API Contracts

| Endpoint Contract | Implementation | Status | Notes |
| --- | --- | --- | --- |
| `GET /api/billing/plans` auth required, selector-first workspace/entity resolution | `routes.js`, `controller.js`, `service.js`, `policy.service.js` | done | Route workspace policy is optional; billing policy resolves workspace or explicit `billableEntityId`. |
| `GET /api/billing/subscription` auth required, selector-first workspace/entity resolution | `routes.js`, `controller.js`, `service.js`, `policy.service.js` | done | Route workspace policy is optional; billing policy resolves workspace or explicit `billableEntityId`. |
| `POST /api/billing/checkout` auth + idempotency key + policy-layer write authorization | `routes.js`, `controller.js`, `checkoutOrchestrator.service.js`, `policy.service.js` | done | Workspace entities require `workspace.billing.manage`; owner-scoped user entities require ownership match. |
| `POST /api/billing/portal` auth + idempotency key + policy-layer write authorization | `routes.js`, `controller.js`, `service.js`, `policy.service.js` | done | Same selector-first authorization model as checkout. |
| `POST /api/billing/payment-links` auth + idempotency key + policy-layer write authorization | `routes.js`, `controller.js`, `service.js`, `policy.service.js` | done | Creates/replays Stripe payment links for one-off billing with invoice-creation enabled. |
| `POST /api/billing/webhooks/stripe` public + csrf off + raw bytes required | `routes.js`, `billingWebhookRawBody.plugin.js`, `controller.js`, `webhook.service.js` | done | Payload size guard included. |
| Path validation for redirect paths | `pathPolicy.js` + usage in service/orchestrator | done | Relative path constraints enforced. |

## 7) Webhook Processing and Raw Body Plumbing

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Raw bytes available and fail closed if missing | `billingWebhookRawBody.plugin.js`, `controller.js` | done | Missing raw body returns 400. |
| Stripe signature verified before dispatch | `webhook.service.js` + `stripeSdk.service.js` | done | Uses `constructEvent` flow. |
| Required Phase 1 events routed explicitly | `webhook.service.js` required event set + dispatcher | done | |
| Event dedupe with webhook events table | `webhook.service.js` + `repository.js` | done | Duplicate insertion race is handled. |
| Ownership matrix enforcement | `webhookProjection.service.js` + checkout/subscription projection services | done | Checkout and subscription ownership separated. |
| Correlation mismatch fail closed + alert | `webhookCheckoutProjection.service.js` + `observabilityService.recordBillingGuardrail` call path | done | Correlation mismatches fail closed and emit `BILLING_CHECKOUT_CORRELATION_MISMATCH` metric events with correlation ids when present. |
| Ordering by provider event created timestamps | projection services use `isIncomingEventOlder` checks | done | Includes equal-timestamp tie-break on provider event id. |
| Same-timestamp semantic reconciliation fallback | `webhookProjection.utils.js` + checkout/subscription/invoice/payment projection call sites | done | Equal timestamp events are ordered deterministically via event-id tie-breakers. |
| Duplicate active subscription canonical selection + remediation enqueue | `webhookSubscriptionProjection.service.js` | done | Deterministic canonical selection + remediation rows. |
| Do not call provider cancellation inline in webhook tx | webhook projection only writes DB state/remediation rows | done | External cancellation runs in worker. |

## 8) Scheduled Reconciliation and Drift Repair

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Reconciliation required in Phase 1 | `reconciliation.service.js` + `workerRuntime.service.js` scheduled loops | done | |
| Single active run lease per provider/scope | DB generated active key + repository acquire logic | done | Race-safe takeover handling added. |
| Reconciliation fencing on run finalization | `reconciliation.service.js` | done | Lease-version mismatch prevents stale finalization. |
| Outbox/remediation lease fencing | worker services + repository CAS updates | done | |
| 15m fast loop for pending/failed webhook focus | worker runtime `pending_recent` scope schedule + `billingWebhookService.reprocessStoredEvent` | done | Reconciliation replays stored failed webhook payloads and tracks replay failures. |
| 6h active subscription baseline loop | worker runtime `subscriptions_active` schedule | done | |
| 30m open checkout loop | worker runtime `checkout_open` schedule | done | |
| 10m recovery verification loop | worker runtime `checkout_recovery_verification` schedule | done | |
| 10m completion pending loop | worker runtime `checkout_completed_pending` schedule | done | |
| Daily invoices/payments loop | worker runtime `invoices_recent` schedule | done | |
| Drift repair rules for checkout/session/subscription/invoice/payment | `reconciliation.service.js` + webhook projection reuse | done | Includes checkout status reconciliation, recovery-hold cleanup, pending expiry/hold handling, invoice/payment refresh, and subscription snapshot backfill projection for completion-pending sessions. |
| Provider side effects via outbox/remediation, not inline tx | outbox/remediation worker architecture | done | |

## 9) Entitlement Schema Registry

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Canonical schema versions | `entitlementSchemaRegistry.js` | done | Includes boolean/quota/string-list v1. |
| Invalid entitlement payload fails closed | `assertEntitlementValueOrThrow` call path in `service.js` | done | Listing/materialization fails closed. |
| Unknown schema version invalid | `entitlementSchemaRegistry.js` | done | |

## 10) Operational Guardrails

| Plan Requirement | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Stable correlation IDs in logs (`operation_key`, event id, entity id) | `observabilityService.recordBillingGuardrail` structured log payloads wired across checkout/recovery/webhook/reconciliation paths | done | Guardrail logs now include correlation ids when present (`operation_key`, `provider_event_id`, `billable_entity_id`). |
| Metrics/alerts for full guardrail list | `recordBillingGuardrailEvent` + `recordBillingGuardrailMeasurement` registry paths plus reconciliation/subscription/outbox/remediation/webhook/idempotency guardrail emitters | done | Billing guardrail counters and measurements are emitted with canonical guardrail codes, including orphan checkout-session cleanup attempts/failures (`BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_ATTEMPT`, `BILLING_ORPHAN_CHECKOUT_SESSION_CLEANUP_FAILURE`) and Stripe SDK/API baseline drift signals (`BILLING_STRIPE_SDK_API_BASELINE_DRIFT`). |

## 11) Phase 1 Delivery Coverage Summary

| Phase 1 Capability | Implementation | Status | Notes |
| --- | --- | --- | --- |
| Workspace-backed billing entity and auth model | policy + migration + routes | done | |
| Plans/checkout/portal/snapshot | service/orchestrator/routes/schema/controller | done | |
| Idempotency with deterministic recovery | idempotency + checkout orchestrator + repository | done | |
| Stripe SDK integration with provenance and replay safety | stripe SDK service + persisted request metadata | done | |
| Webhook ownership matrix and projection | webhook and projection services | done | |
| Duplicate-subscription remediation pipeline | projection + remediation worker | done | |
| Reconciliation service and scheduled loops | reconciliation + worker runtime + server lifecycle wiring | done | |

## 12) Test Requirements

| Plan Requirement | Implementation Status | Notes |
| --- | --- | --- |
| Billing test matrix from section 12 | partial | Added targeted billing tests (service, webhook, checkout-session, retention), but full section-12 matrix is not exhaustively implemented yet. |

## 13) Phase 2 (Merged Program) Roadmap Coverage

| Phase 2 Scope Item | Implementation | Status | Notes |
| --- | --- | --- | --- |
| 2.1 `billing_payment_methods` table and payment-method sync events | `migrations/20260221110000_add_billing_phase2_1_tables.cjs` + payment-method repository methods + `GET/POST /api/billing/payment-methods*` | partial | Manual sync path is implemented; provider-webhook-driven payment-method sync parity remains pending. |
| 2.1 usage counters + windowed limits | `billing_usage_counters` + `billing_usage_events` dedupe table, repository usage claim/increment ops, `billingService.recordUsage`, and `billingService.enforceLimitAndRecordUsage` | partial | Counter persistence, UTC windows, hard-limit prechecks, and retry-safe increment dedupe are implemented; broad feature-by-feature rollout is still pending. |
| 2.1 clean app-facing limitations contract | `billingService.getLimitations` + `GET /api/billing/limitations` + client API surface + capability map (`server/modules/billing/appCapabilityLimits.js`) | partial | Contract is available for app/runtime consumption and representative server-side enforcement wiring (`projects.create`) is implemented; full app coverage remains pending. |
| 2.2 console billing event explorer (global) | `GET /api/console/billing/events` + console billing view/route + console guard/nav wiring | done | Event-source parity includes idempotency, checkout-session, subscription, invoice, payment, payment-method-sync, webhook, outbox, remediation, and reconciliation sources with workspace/user/entity correlation filters. |
| 2.2 workspace billing UX (user-friendly) | `GET /api/billing/timeline` + workspace billing view/route + admin-shell nav wiring + purchase-tab scaffold (`src/views/workspace-billing/*`) | partial | Timeline plus purchase scaffold are shipped (core subscription checkout from a single plan-mapped monthly Stripe price, plus one-off catalog/ad-hoc payment links); advanced reporting and richer operator workflows are still pending. |
| 2.3 metered/hybrid component enablement | Core plan checkout is intentionally simplified to one Stripe recurring plan price per plan (no bundled seats/metered/add-on components) | done | Extras are intentionally moved to separate payment-link or separate purchase flows. |
| 2.3 one-off billing flows | `POST /api/billing/payment-links` supports catalog/ad-hoc one-off purchases with invoice projection into `billing_invoices`; workspace purchase UI can initiate these extras flows | partial | Core payment-link orchestration and scaffold UX are implemented; richer catalog curation and operator tooling remain pending. |
| 2.4 non-workspace billable entities | `migrations/20260221150000_add_billing_phase2_4_billable_entity_scopes.cjs` + repository scope methods + policy entity-selector resolution + billing route workspace-policy relaxation | partial | Schema now supports `entity_type`/`entity_ref` and nullable workspace/owner linkage; explicit billable-entity selector policy supports workspace + owner-scoped user entities and billing routes now allow selector-first access. Broader non-workspace auth models (organization/external) remain pending. |
| 2.4 expanded analytics/provider parity | Stripe-only productionized provider path today | deferred | Requires additional provider abstractions and parity analytics/reporting. |

## Runtime Integration Matrix

| Integration Point | File | Status | Notes |
| --- | --- | --- | --- |
| Billing repository registration | `server/runtime/repositories.js` | done | |
| Billing services construction | `server/runtime/services.js` | done | Includes checkout/webhook/outbox/remediation/reconciliation/worker runtime. |
| Billing controllers construction | `server/runtime/controllers.js` | done | |
| Runtime service export | `server/runtime/index.js` | done | |
| API route inclusion | `server/modules/api/routes.js` | done | |
| Route registration support | `server/fastify/registerApiRoutes.js` | done | |
| Raw-body webhook plugin registration | `server.js` + `server/fastify/billingWebhookRawBody.plugin.js` | done | |
| Billing worker runtime lifecycle start/stop | `server.js` (`onReady`/`onClose`) | done | |
| Env configuration surface | `server/lib/env.js` + `.env.example` | done | |
| Client API exposure | `src/services/api/billingApi.js`, `src/services/api/index.js` | done | |

## Explicit Remaining Gaps (Non-Test)

| Gap | Status | Suggested Next Step |
| --- | --- | --- |
| Full section-12 billing test matrix is not fully exhaustive yet | partial | Continue expanding tests for all listed race, recovery, webhook-ordering, and reconciliation permutations. |
