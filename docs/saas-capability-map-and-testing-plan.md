# SaaS Capability Map and Testing Plan

Last verified: 2026-02-20

## 1) What This Repository Already Covers

This repository is not just an annuity demo. It is a broad SaaS scaffold with multiple surfaces, tenancy, RBAC, realtime, AI, observability, and billing.

### 1.1 Product surfaces and routing

- `app` surface (workspace required)
- `admin` surface (workspace required)
- `console` surface (global, no workspace required)
- Surface registry and path policy: `shared/routing/surfaceRegistry.js`, `shared/routing/surfacePaths.js`
- Server page guard and redirects across surfaces: `server.js`
- Frontend route wiring:
  - app/admin route factory: `src/routerFactory.js`
  - console route set: `src/routes/consoleCoreRoutes.js`
  - route guards: `src/routerGuards.js`, `src/routerGuards.console.js`

### 1.2 Auth and session infrastructure

- Supabase-backed register/login/logout/session
- OTP login flows
- OAuth start/complete flows
- password forgot/recovery/reset
- account security features (link/unlink providers, logout other sessions)
- cookies + CSRF + per-route auth policy via Fastify plugin
- Key files:
  - `server/modules/auth/routes.js`
  - `server/modules/auth/service.js`
  - `server/fastify/auth.plugin.js`

### 1.3 Multi-tenancy and workspace lifecycle

- Tenancy modes: `personal`, `team-single`, `multi-workspace`
- Personal-workspace auto-provisioning
- workspace selection and last-active workspace memory
- workspace request-context resolution with surface-aware access decisions
- Key files:
  - `server/lib/appConfig.js`
  - `server/domain/workspace/services/workspace.service.js`
  - `server/surfaces/appSurface.js`
  - `server/surfaces/adminSurface.js`

### 1.4 RBAC and permissions

- Workspace RBAC manifest with owner/admin/member/viewer
- Console-specific role model (`console`, `devop`, `moderator`)
- Permission gating on API routes and realtime topics
- Key files:
  - `shared/auth/rbac.manifest.json`
  - `server/lib/rbacManifest.js`
  - `server/domain/console/policies/roles.js`

### 1.5 Workspace admin and collaboration

- Workspace settings read/update
- role catalog + member role updates
- workspace invites (create/revoke/redeem)
- workspace invite email service scaffold
- app-surface deny list policy (`surfaceAccess.app.denyUserIds/denyEmails`)
- Key files:
  - `server/modules/workspace/routes/admin.route.js`
  - `server/domain/workspace/services/admin.service.js`
  - `server/domain/workspace/services/inviteEmail.service.js`

### 1.6 Console governance and ops views

- bootstrap and membership model for console access
- root identity protection (`console_root_identity`)
- console invites and role management
- console browser/server error dashboards
- console AI transcript cross-workspace read/export
- console assistant settings
- Key files:
  - `server/modules/console/routes.js`
  - `server/domain/console/services/console.service.js`
  - `server/modules/consoleErrors/routes.js`
  - `server/domain/console/services/errors.service.js`

### 1.7 Realtime WebSocket system

- endpoint: `GET /api/realtime`
- authenticated handshake
- subscribe/unsubscribe/ping protocol
- topic + surface + permission enforcement at subscribe time
- heartbeat, payload-byte limits, fanout, cleanup lifecycle
- in-memory event bus and envelope model
- Key files:
  - `server/fastify/registerRealtimeRoutes.js`
  - `server/fastify/realtime/subscribeContext.js`
  - `server/domain/realtime/services/events.service.js`
  - `shared/realtime/topicRegistry.js`
  - `WS_ARCHITECTURE.md`

### 1.8 Domain features currently present

- annuity calculation engine + history persistence
- workspace-scoped projects CRUD
- user settings + avatar upload pipeline (Sharp + FS storage)
- communications module (SMS driver abstraction)
- Key files:
  - `server/modules/annuity/*`
  - `server/modules/history/*`
  - `server/modules/projects/*`
  - `server/modules/settings/*`
  - `server/domain/users/avatar*.js`
  - `server/domain/communications/services/sms.service.js`

### 1.9 AI assistant and transcript governance

- workspace chat stream endpoint (NDJSON event stream)
- tool-calling loop with bounded tool call count
- currently registered tool: workspace rename
- per-surface tool allowlists
- transcript modes (`standard`, `restricted`, `disabled`)
- transcript redaction and restricted storage mode
- admin and console transcript read/export APIs
- Key files:
  - `server/modules/ai/routes.js`
  - `server/modules/ai/service.js`
  - `server/modules/ai/tools/registry.js`
  - `server/modules/ai/transcripts/service.js`
  - `server/modules/ai/transcripts/redactSecrets.js`

### 1.10 Billing (Stripe phase-1 architecture)

- plan/snapshot/checkout/portal APIs
- Stripe webhook ingestion with raw-body signature path
- idempotency and replay controls
- checkout session lifecycle tracking
- outbox worker, remediation worker, reconciliation runner
- substantial billing schema (customers, plans, prices, subscriptions, invoices, payments, idempotency, outbox, remediations)
- Key files:
  - `server/modules/billing/routes.js`
  - `server/modules/billing/*.service.js`
  - `migrations/20260221090000_create_billing_phase1_tables.cjs`

### 1.11 Observability, security audit, and operations

- health + readiness endpoints
- Prometheus metrics endpoint
- structured request logging and metric instrumentation
- security audit event persistence with metadata sanitization
- retention sweep tooling for logs/invites/audit/AI/billing artifacts
- ops docs for observability, backup/restore, release process
- Key files:
  - `server/modules/health/*`
  - `server/modules/observability/*`
  - `server/lib/observability/metrics.js`
  - `server/domain/security/services/audit.service.js`
  - `server/domain/operations/services/retention.service.js`
  - `bin/retentionSweep.js`
  - `docs/observability.md`, `docs/retention-jobs.md`, `docs/backup-restore-runbook.md`, `docs/release-checklist.md`

## 2) API Surface Size (Current)

HTTP routes registered via module route builders: 77

- auth: 11
- workspace bootstrap/self-service/admin: 16
- console: 14
- console errors: 6
- settings: 11
- projects: 5
- communications: 1
- history: 1
- annuity: 1
- ai: 3
- billing: 5
- observability: 1
- health: 2

Realtime route (websocket): 1 (`/api/realtime`)

## 3) Data Model Footprint

Current migrations create 32 tables (workspace/auth/user, console, AI transcripts, billing, audit, errors, etc.).

## 4) Current Test Baseline (Executed 2026-02-20)

### 4.1 Passing suites

- Backend node tests: `npm test`
  - 357 tests, 357 passed, 0 failed
- Client unit/integration (Vitest): `npm run test:client`
  - 26 files, 173 tests, all passed
- Vue view suites: `npm run test:client:views`
  - 25 files, 143 tests, all passed
- Realtime focused suites (rerun explicitly):
  - `tests/realtimeRoutes.test.js`
  - `tests/realtimeSubscribeWorkspaceRequired.test.js`
  - `tests/realtimeWsAuthUpgrade.test.js`
  - 12 tests, all passed

### 4.2 Failing suite

- Playwright e2e: `npm run test:e2e`
  - 3 tests, 3 failed (`tests/e2e/auth-history.spec.js`)
  - Symptoms:
    - login test times out waiting for `getByLabel("Email")`
    - calculator tests stay at `/` instead of redirecting to `/w/acme`

Interpretation: end-to-end expectations are currently out of sync with runtime behavior (or the mocks in this e2e spec), while unit/integration layers are green.

## 5) What Is Scaffolded vs Fully Wired

### Implemented enough for serious testing now

- Auth/session and CSRF/rate-limit wiring
- Workspace tenancy/context and RBAC route enforcement
- Console governance and error ingestion/reporting
- Realtime protocol and authz enforcement
- AI stream + transcript persistence and redaction modes
- Billing orchestration architecture (including workers and reconciliation)
- Observability + audit + retention jobs

### Present but intentionally not fully integrated

- SMS delivery:
  - `SMS_DRIVER=plivo` currently returns `not_implemented`
  - file: `server/domain/communications/services/sms.service.js`
- Workspace invite SMTP delivery:
  - `WORKSPACE_INVITE_EMAIL_DRIVER=smtp` currently returns `not_implemented`
  - file: `server/domain/workspace/services/inviteEmail.service.js`
- Console moderation feature set is still placeholder-level (roles/policy scaffolding exists, feature workflows are not built yet).

## 6) "Test The Hell Out Of It" Plan (Risk-First)

### Phase 0 (Immediate): recover green e2e smoke

1. Fix `tests/e2e/auth-history.spec.js` to match current runtime bootstrapping and login DOM behavior.
2. Lock selectors with stable test IDs where labels are brittle.
3. Keep these as required pre-merge smoke tests.

### Phase 1: tenancy and authorization hardening

1. Add multi-user, multi-workspace API integration tests that assert no cross-workspace leakage for:
   - projects
   - history
   - transcripts
   - settings
2. Add console/access boundary tests for:
   - non-console user hitting console routes
   - pending-invite-only user behavior
   - root identity mutation constraints
3. Add negative tests for app-surface deny-list behavior under mixed surfaces.

### Phase 2: realtime stress and race tests

1. Add websocket concurrency tests (N clients, same workspace/topic) verifying fanout integrity and no duplicate/self-event corruption.
2. Add reconnect/resubscribe tests with stale requestId ACK handling.
3. Add commandId/clientId collision/retry tests around project + workspace settings events.
4. Add long-run heartbeat/idle timeout soak test.

### Phase 3: billing correctness and resilience

1. Add integration tests for idempotent checkout replay with repeated client keys.
2. Add webhook replay/out-of-order event tests.
3. Add worker lease-fencing tests under simulated parallel workers.
4. Add reconciliation drift repair tests using synthetic provider state mismatch.

### Phase 4: security and abuse scenarios

1. Add targeted auth abuse tests (credential stuffing rate-limit behavior, OTP brute-force windows).
2. Add CSRF bypass regression tests across all unsafe methods with route-level opt-out exceptions.
3. Add fuzz tests for JSON schema-heavy routes.
4. Add transcript redaction adversarial payload tests.

### Phase 5: performance and capacity baselines

1. Measure p95/p99 latency for bootstrap, workspace settings, projects list, AI stream start.
2. Add dataset-scale tests for pagination-heavy paths.
3. Add retention job runtime benchmarks on large synthetic tables.
4. Define pass/fail SLO thresholds and track in CI artifacts.

## 7) Suggested CI Test Pyramid

Fast lane (every PR):

- `npm test`
- `npm run test:client`
- `npm run test:client:views`

Gated lane (required before release):

- `npm run test:e2e`
- coverage gates (`npm run test:coverage` + client coverage suites)

Nightly resilience lane:

- websocket stress suite
- billing worker/reconciliation stress suite
- retention dry-run + execution against seeded large fixtures

## 8) Recommended Next Actions

1. Repair the failing Playwright file first so your top-level smoke path is trustworthy.
2. Add cross-workspace isolation integration tests for projects/history/transcripts as your next highest-risk gap.
3. Add websocket concurrency/race tests once e2e smoke is back to green.

