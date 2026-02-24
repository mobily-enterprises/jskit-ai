# JSKit Value App Docs

Last reorganized: 2026-02-24 (UTC)

## Quick Start By Task

- Changing package/runtime/UI boundaries: `architecture/client-boundaries.md`
- Working on workspace, tenancy, or surface splits: `architecture/workspace-and-surfaces.md`
- Changing billing behavior or payloads: `billing/contracts.md`
- Integrating billing into a feature: `billing/integration.md`
- Touching provider adapters/webhooks: `billing/provider-insulation.md`
- Looking up schema ownership across domains: `database/schema-areas.md`
- Debugging billing table semantics in detail: `database/billing-live-schema.md`
- Running migrations or seeds: `database/migrations-and-seeds.md`
- Preparing a release: `operations/release-checklist.md`
- Setting up metrics and alerts: `operations/observability.md`
- Operating retention jobs/worker: `operations/retention-worker.md`

## Document Guide

### Architecture

- `architecture/client-boundaries.md`
  - The boundary contract for package code vs app code. It also captures variability seams, shared client-element ownership, and enforcement tests.
- `architecture/workspace-and-surfaces.md`
  - The decision record for workspace-native architecture and the admin/app surface model. Includes accepted invariants, route/auth rules, and rollout backlog.

### Billing

- `billing/contracts.md`
  - The hard billing API contract: selectors, limitations response shape, idempotency behavior, canonical failure codes, and plan-state rules.
- `billing/integration.md`
  - The practical integration playbook: when to call limitations APIs, where usage consumption must occur, and required fail-closed behavior for features.
- `billing/provider-insulation.md`
  - The provider-boundary contract: adapter interfaces, webhook translation ownership, provider outcome policy, and guardrails against provider leakage into core billing.

### Database

- `database/schema-areas.md`
  - Domain-oriented map of the schema so you can quickly find table ownership and where each area lives.
- `database/billing-live-schema.md`
  - Field-by-field billing table reference built from live schema introspection; useful for reconciliation, migrations, and operational debugging.
- `database/migrations-and-seeds.md`
  - The migration and seed command runbook, with source locations and operational notes.

### Operations

- `operations/release-checklist.md`
  - End-to-end release safety checklist: env, DB, quality gates, runtime checks, security checks, smoke tests, and rollback readiness.
- `operations/observability.md`
  - Metrics runbook covering endpoint behavior, metric names/labels, scrape config, alert templates, and starter dashboard queries.
- `operations/retention-worker.md`
  - Canonical retention worker runbook: topology, queue/job contracts, operator commands, lock/retry/dead-letter behavior, and scheduler examples.

## Source Merge Map

- `docs/architecture/app-variability-matrix.md` + `docs/architecture/headless-client-contract.md` + `docs/shared-ui.md` -> `architecture/client-boundaries.md`
- `apps/jskit-value-app/docs/multihome.md` -> `architecture/workspace-and-surfaces.md` (cleaned decision record, transcript noise removed)
- `docs/retention-jobs.md` + `docs/retention-worker-runbook.md` + `docs/worker-runtime.md` -> `operations/retention-worker.md`
- `docs/billing/*` -> `billing/*`
- `docs/db/*` -> `database/*`
- `docs/observability.md` + `docs/release-checklist.md` -> `operations/*`

## Intentionally Dropped (No Contract Loss)

- `docs/README.md`, `docs/billing/README.md`, `docs/db/README.md`

These were index-only wrappers with no unique contract or runbook behavior.
