# jskit-ai Monorepo

This repository contains the JSKit monorepo, with `apps/jskit-value-app` as the active application surface.

If you are jumping in fresh, start with the app docs index:

- `apps/jskit-value-app/docs/README.md`

## Documentation Map (JSKit Value App)

These are the current canonical docs for the app, with a quick explanation of why each one exists.

### Architecture

- `apps/jskit-value-app/docs/architecture/client-boundaries.md`
  - Read this when you are changing shared packages, client runtimes, or UI wrappers. It defines what belongs in packages vs app code, plus guardrails and shared-element ownership.
- `apps/jskit-value-app/docs/architecture/workspace-and-surfaces.md`
  - Read this when working on tenancy, workspace flows, or admin/app surface separation. It captures the major architecture decisions and the execution backlog.

### Billing

- `apps/jskit-value-app/docs/billing/contracts.md`
  - The hard API and error-code contract for billing. Use this before changing endpoints, idempotency, or billing failure behavior.
- `apps/jskit-value-app/docs/billing/integration.md`
  - Practical guide for wiring billing into features. It explains where to check limitations, where to consume usage, and what fail-closed behavior is expected.
- `apps/jskit-value-app/docs/billing/provider-insulation.md`
  - Boundary contract for provider isolation (Stripe/Paddle and future providers). Use this when changing provider wiring, webhook translation, or error normalization.

### Database

- `apps/jskit-value-app/docs/database/schema-areas.md`
  - High-level map of the database by domain area. Use this first when orienting yourself to tables outside billing.
- `apps/jskit-value-app/docs/database/billing-live-schema.md`
  - Detailed field-level billing schema reference captured from the live schema. Use this for exact column semantics and reconciliation/debug work.
- `apps/jskit-value-app/docs/database/migrations-and-seeds.md`
  - Operational migration/seed commands and conventions. Use this when preparing local setup, migration rollouts, or seed runs.

### Operations

- `apps/jskit-value-app/docs/operations/release-checklist.md`
  - Pre-release gate checklist. Use this before shipping to make sure env, quality, runtime, and rollback readiness checks are covered.
- `apps/jskit-value-app/docs/operations/observability.md`
  - Metrics/alerts/dashboard runbook. Use this when setting up `/api/metrics`, Prometheus scraping, and alert rules.
- `apps/jskit-value-app/docs/operations/retention-worker.md`
  - Canonical runbook for the retention queue and worker lifecycle. Use this for dry-runs, scheduling, lock contention handling, and DLQ operations.

## Shared UI Ownership Status

This table tracks the core shared client elements and ownership.

| Package | Domain | Owner | Status |
| --- | --- | --- | --- |
| `@jskit-ai/billing-plan-client-element` | Billing | Shared UI Guild | Migrated |
| `@jskit-ai/chat-client-element` | Chat | Shared UI Guild | Migrated |
| `@jskit-ai/assistant-client-element` | Assistant | Shared UI Guild | Migrated |
| `@jskit-ai/profile-client-element` | Profile | Shared UI Guild | Migrated |

## Shared UI Reference

- `apps/jskit-value-app/docs/architecture/client-boundaries.md`
