# @jskit-ai/billing-worker-core

Background worker services for billing outbox jobs, remediations, reconciliation, and runtime scheduling.

## What this package is for

Use this package to run asynchronous billing maintenance and repair tasks outside request/response APIs.

It handles:

- outbox jobs (for delayed/retryable billing actions)
- remediation jobs (fixing duplicate/subscription anomalies)
- reconciliation sweeps (detecting and fixing drift)
- interval-based worker runtime loops

## Key terms (plain language)

- `outbox`: table/queue of background jobs created by billing flows.
- `remediation`: targeted corrective action for data/provider anomalies.
- `reconciliation`: periodic comparison between local DB state and provider state.
- `lease`: temporary lock so only one worker processes one job at a time.

## Public API

## `createBillingSubsystem(options)` and `createBillingDisabledServices()`

Creates the billing runtime subsystem object used by app composition roots.

Returned shape includes:

- policy/pricing/idempotency/checkout/webhook services
- worker services + runtime service
- `billingService`
- `billingPromoProvisioner`

`createBillingDisabledServices()` returns fail-closed no-op equivalents when billing is disabled.

## `createBillingOutboxWorkerService(options)`

Creates outbox worker behavior.

Returned methods:

- `leaseNextJob({ workerId, leaseSeconds, now })`
  - Atomically claims the next runnable outbox job.
  - Real example: worker picks next `expire_checkout_session` job.
- `executeJob({ jobId, leaseVersion })`
  - Executes leased job and marks success.
  - Real example: calls provider to expire stale checkout session.
- `retryOrDeadLetter({ jobId, leaseVersion, error, now })`
  - Applies retry policy or dead-letters failed job.
  - Real example: network failure increments attempts and reschedules job.
- `runExpireCheckoutSession(payload)`
  - Executes the `expire_checkout_session` operation directly.
  - Real example: cleanup for orphaned checkout sessions.

## `createBillingRemediationWorkerService(options)`

Creates remediation worker behavior.

Returned methods:

- `leaseNextRemediation({ workerId, leaseSeconds, now })`
  - Claims pending remediation item.
  - Real example: pick duplicate-subscription cancellation task.
- `runCancelDuplicateSubscription({ remediationId, leaseVersion })`
  - Cancels duplicate provider subscription and resolves remediation row.
  - Real example: two subscriptions created accidentally for one workspace.
- `retryOrDeadLetterRemediation({ remediationId, leaseVersion, error, now })`
  - Handles retries/dead-letter for remediation failures.
  - Real example: temporary provider failure reschedules remediation.

## `createBillingReconciliationService(options)`

Creates reconciliation service.

Returned methods:

- `runScope({ provider, scope, runnerId, leaseSeconds, now })`
  - Runs one reconciliation scope.
  - Real examples:
    - `checkout_open`: check old open sessions.
    - `checkout_completed_pending`: reconcile completed-but-unprojected sessions.
    - `checkout_recovery_verification`: evaluate pending recovery holds.
    - `pending_recent`: process recent pending idempotency rows.
    - `subscriptions_active`: verify active subscriptions against provider.

## `createBillingWorkerRuntimeService(options)`

Creates long-running interval scheduler that runs the worker loops.

Returned methods:

- `start()`
  - Starts polling loops for outbox/remediation/plan-change/reconciliation tasks.
  - Real example: called once when API server starts in worker-enabled mode.
- `stop()`
  - Stops all polling timers.
  - Real example: graceful shutdown before process exit.
- `isStarted()`
  - Returns runtime started state.
  - Real example: health/debug endpoint can expose worker state.

## How apps use this package (and why)

Typical flow:

1. App wires billing repository, provider adapter, and billing services.
2. App creates outbox/remediation/reconciliation services.
3. App creates runtime service and calls `start()`.
4. Runtime loops keep billing state healthy over time.

Why apps use it:

- prevents slow/fragile maintenance work from blocking API requests
- improves billing reliability with retries, leases, and reconciliation
