# JSKit Value App Docs

Last reorganized: 2026-02-25 (UTC)

## Quick Start By Task

- Changing package/runtime/UI boundaries: `architecture/client-boundaries.md`
- Working on workspace, tenancy, or surface splits: `architecture/workspace-and-surfaces.md`
- Customizing module URL mounts: `architecture/url-mount-customization.md`
- Working on module dependency/capability compatibility: `architecture/module-capabilities.md`
- Working on profile/module-pack composition rules: `architecture/module-profiles.md`
- Authoring external framework modules/extensions: `architecture/module-authoring.md`
- Understanding action runtime execution and contributor ownership: `architecture/action-runtime-and-contributors.md`
- Working on social feed/federation architecture: `architecture/social-federation.md`
- Changing canonical action IDs, ownership, or versioning: `architecture/action-catalog-governance.md`
- Learning end-to-end request/data flow through runtime: `flows/0.index.md`
- Following implementation checklists (humans + AI): `playbooks/0.index.md`
- Changing billing behavior or payloads: `billing/contracts.md`
- Integrating billing into a feature: `billing/integration.md`
- Touching provider adapters/webhooks: `billing/provider-insulation.md`
- Looking up schema ownership across domains: `database/schema-areas.md`
- Debugging billing table semantics in detail: `database/billing-live-schema.md`
- Running migrations or seeds: `database/migrations-and-seeds.md`
- Preparing a release: `operations/release-checklist.md`
- Setting up metrics and alerts: `operations/observability.md`
- Operating retention jobs/worker: `operations/retention-worker.md`
- Realtime envelope field requirements: `realtime/contracts.md`
- Realtime mutation sync status by domain: `realtime/coverage-matrix.md`
- Realtime operations + troubleshooting: `realtime/operations.md`

## Document Guide

### Architecture

- `architecture/client-boundaries.md`
  - The boundary contract for package code vs app code. It also captures variability seams, shared client-element ownership, and enforcement tests.
- `architecture/workspace-and-surfaces.md`
  - The decision record for workspace-native architecture and the admin/app surface model. Includes accepted invariants, route/auth rules, and rollout backlog.
- `architecture/url-mount-customization.md`
  - Workspace route mount override contract (mount keys, collision rules, and route fragment expectations).
- `architecture/module-capabilities.md`
  - Server module dependency/capability contract, strict/permissive composition behavior, and dependency check command usage.
- `architecture/module-profiles.md`
  - Profile contract (`web-saas-default`), required module enforcement, and optional module pack selection behavior.
- `architecture/module-authoring.md`
  - Extension descriptor contract, supported contribution keys, and extension validation/bootstrap loading workflow.
- `architecture/action-runtime-and-contributors.md`
  - Deep-dive for the canonical action execution path: contracts, registry pipeline, context shaping, contributor ownership, assistant tool derivation, and data examples.
- `architecture/action-catalog-governance.md`
  - Canonical governance for action inventory and naming: how `actions_map.md`, `shared/actionIds.js`, contributors, and tests stay in lockstep.
- `architecture/social-federation.md`
  - Social domain architecture for local feed entities, moderation ownership, public ActivityPub endpoints, signature handling, and delivery retry model.

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

### Flows

- `flows/0.index.md`
  - Ordered tutorial index (`01` to `16`) that follows request, action runtime, permissions, realtime, assistant tools, billing, and worker execution paths.
- `flows/01.endpoint-a-to-z.md`
  - End-to-end teaching tutorial from a trivial `[]` endpoint to repository/service/action runtime/realtime/permissioned `PATCH` flow.
- `flows/05.permissions.md`
  - Deep flow tutorial for where permissions are defined, assigned, resolved, and enforced at both route and action levels.
- `flows/07.realtime.md`
  - Full socket lifecycle tutorial: connect, subscribe, publish, and fanout with surface-aware authorization.

### Realtime

- `realtime/contracts.md`
  - Required envelope fields and runtime delivery rules for workspace broadcast, workspace-targeted, global-targeted, and user-scoped topic events.
- `realtime/coverage-matrix.md`
  - Current mutation-to-realtime sync status across major domains, including correlation-header guardrails for event-producing writes.
- `realtime/operations.md`
  - Production runbook for realtime reliability model, health signals, thresholds, and triage.

### Playbooks

- `playbooks/0.index.md`
  - Cross-cutting delivery playbooks for both human contributors and AI agents.
- `playbooks/01.endpoint-delivery.md`
  - Step-by-step endpoint delivery checklist aligned with action runtime architecture.
- `playbooks/02.anti-patterns.md`
  - Merge-time anti-pattern checklist to prevent architectural drift.
- `playbooks/03.testing-minimums.md`
  - Minimum test expectations by change type.
- `playbooks/04.mega-saas-prompt.md`
  - A playful, exhaustive prompt template that enumerates the full SaaS capability surface for generation/bootstrap experiments.
