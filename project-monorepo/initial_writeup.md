# Project Monorepo Strategy And Shared Package Architecture

Status: Proposed v1  
Date: 2026-02-23  
Scope: Multi-app SaaS platform using one repository initially, with planned future repo splits.

## 1. Executive Summary

This document defines how to structure code so we can:

1. Ship quickly now with frequent cross-app atomic changes.
2. Reduce boilerplate across apps.
3. Upgrade shared features across all apps by version bumps.
4. Avoid over-abstracting DB-heavy systems too early.
5. Split apps into separate repositories later with minimal rework.

Core decision:

1. Start with one "project monorepo" containing all apps and all shared packages.
2. Treat shared code as true npm packages from day one (`packages/*`).
3. Enforce dependency boundaries now so later extraction is mechanical.
4. Split repositories later when release cadence and ownership diverge.

## 2. First Principles

1. Monorepo and npm packages solve different problems.
2. Monorepo optimizes development and atomic changes.
3. npm packages optimize reuse, versioning, and upgrade control.
4. A monorepo can contain many npm packages.
5. A package must encapsulate stable behavior, not random shared files.

## 3. Decision: Start Mega, Design For Split

We will begin with one repository (`project-monorepo`) and use workspace packages.

The key is not "single repo vs many repos". The key is "do boundaries exist and are they enforced".

Boundaries we must enforce from day one:

1. `apps/*` cannot import each other.
2. `packages/*` cannot import from `apps/*`.
3. Shared package APIs are explicit and versioned.
4. App-specific policy and schema stay in app layers.

If these are enforced, future repo splits are straightforward.

## 4. Repository Topology

## 4.1 Initial Topology (Now)

```text
project-monorepo/
  apps/
    saas-a/
      web/
      api/
    saas-b/
      web/
      api/
    saas-c/
      web/
      api/
  packages/
    contracts/
      surface-routing/
      realtime-contracts/
    auth/
      rbac-core/
      fastify-auth-policy/
    realtime/
      realtime-client-runtime/
      realtime-socketio-server/
    billing/
      billing-provider-core/
      entitlements-core/
      entitlements-knex-mysql/
    web/
      http-client-runtime/
    tooling/
      tsconfig/
      eslint-config/
      build-config/
  docs/
    architecture/
    adr/
  turbo.json
  pnpm-workspace.yaml
  package.json
```

## 4.2 Topology Later (After Divergence)

```text
org/
  platform-monorepo/        # shared packages only
  saas-a-repo/              # app repo
  saas-b-repo/
  saas-c-repo/
```

Migration remains low-friction if package names and contracts remain stable.

## 5. Why Not One Big "Infrastructure" Package

Do not create a single umbrella npm package with permissions + realtime + billing + DB.

Problems with umbrella package:

1. High coupling and accidental breaking changes.
2. Unnecessary transitive dependencies for every app.
3. Hard to version safely.
4. App teams cannot adopt features incrementally.
5. DB/storage assumptions leak everywhere.

Preferred model:

1. One package per cohesive capability.
2. Explicit extension points via adapters/interfaces.
3. Optional meta-package for curated version sets.

## 6. Package Portfolio (Detailed)

This is the recommended package set for your current code patterns.

## 6.1 `@jskit/surface-routing`

Purpose:

1. Shared route/surface concepts (`app`, `console`, `admin`, etc.).
2. Surface path builders/parsers for client and server.
3. Eliminate duplicated surface resolution logic.

Likely extraction sources:

1. `shared/routing/surfaceRegistry.js`
2. `shared/routing/surfacePaths.js`

Public API sketch:

```ts
export type SurfaceId = 'app' | 'console' | 'admin';

export interface SurfaceDefinition {
  id: SurfaceId;
  basePath: string;
  requiresAuth: boolean;
}

export function defineSurfaces(defs: SurfaceDefinition[]): SurfaceDefinition[];
export function buildSurfacePath(surface: SurfaceId, path: string): string;
export function resolveSurfaceFromPath(pathname: string): SurfaceId | null;
```

Why this is good:

1. Very stable semantics.
2. Minimal DB coupling.
3. Shared by frontend routing and backend route policy.

What stays app-local:

1. App-specific route trees.
2. Product-specific redirects.

## 6.2 `@jskit/rbac-core`

Purpose:

1. Normalize role/permission manifest.
2. Evaluate permissions consistently across domains.
3. Remove duplicated `hasPermission` implementations.

Likely extraction sources:

1. `server/lib/rbacManifest.js`
2. `shared/auth/rbac.manifest.json` patterns
3. Repeated policy checks in server modules

Public API sketch:

```ts
export interface RoleDefinition {
  role: string;
  permissions: string[];
  inherits?: string[];
}

export interface RbacManifest {
  roles: RoleDefinition[];
}

export interface PermissionCheckInput {
  roles: string[];
  grants?: string[];
  denies?: string[];
}

export interface RbacEngine {
  has(permission: string, input: PermissionCheckInput): boolean;
  listEffectivePermissions(input: PermissionCheckInput): string[];
}

export function createRbacEngine(manifest: RbacManifest): RbacEngine;
```

Why this is good:

1. Deterministic, pure logic.
2. Easy to test with fixtures.
3. Shared behavior between API, jobs, and UI guards.

What stays app-local:

1. Manifest content (actual permission names).
2. Domain policy decisions.

## 6.3 `@jskit/fastify-auth-policy`

Purpose:

1. Route-level auth policy wiring for Fastify.
2. Standardize actor resolution, workspace resolution, permission checks.
3. Remove repetitive hook setup and guard boilerplate.

Likely extraction sources:

1. `server/fastify/auth.plugin.js`
2. `server/fastify/registerApiRoutes.js`
3. Shared guard patterns in route registration

Public API sketch:

```ts
export interface AuthPolicyRouteMeta {
  requireAuth?: boolean;
  requiredPermissions?: string[];
  requireWorkspace?: boolean;
}

export interface AuthPolicyDependencies {
  resolveActor: (req: unknown) => Promise<{ id: string } | null>;
  resolveWorkspaceContext: (req: unknown) => Promise<{ workspaceId: string } | null>;
  hasPermission: (args: {
    actorId: string;
    workspaceId?: string;
    permission: string;
  }) => Promise<boolean>;
}

export function authPolicyPlugin(deps: AuthPolicyDependencies): unknown;
export function withAuthPolicy(meta: AuthPolicyRouteMeta): AuthPolicyRouteMeta;
```

Why this is good:

1. Keeps policy plumbing consistent.
2. Preserves app-specific authorization logic through injected dependencies.
3. Works for multiple apps without forcing shared DB schema.

What stays app-local:

1. User/session data access.
2. Workspace membership model.

## 6.4 `@jskit/realtime-contracts`

Purpose:

1. Shared definitions for event types, topics, commands, protocol.
2. Prevent client/server contract drift.

Likely extraction sources:

1. `shared/realtime/eventTypes.js`
2. `shared/realtime/protocolTypes.js`
3. `shared/realtime/topicRegistry.js`

Public API sketch:

```ts
export type TopicName = 'workspace' | 'project' | 'chat';

export interface TopicScope {
  topic: TopicName;
  workspaceId?: string;
  projectId?: string;
}

export interface EventEnvelope<TType extends string, TPayload> {
  type: TType;
  occurredAt: string;
  payload: TPayload;
  correlationId?: string;
}

export const TopicRegistry: Record<string, { requiresWorkspace: boolean }>;
```

Why this is good:

1. Very high reuse.
2. Low coupling.
3. Reduces realtime bugs from mismatched payload assumptions.

What stays app-local:

1. Domain-specific payload fields.
2. Authorization mapping by product rules.

## 6.5 `@jskit/realtime-client-runtime`

Purpose:

1. Generic client runtime for socket connection, subscriptions, retries, command ACK tracking.
2. App plugs in event handlers and topic permissions.

Likely extraction sources:

1. `src/services/realtime/realtimeRuntime.js`
2. `src/services/realtime/commandTracker.js`
3. `src/services/realtime/realtimeEventBus.js`

Public API sketch:

```ts
export interface RealtimeTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(command: unknown): Promise<void>;
  onEvent(cb: (event: unknown) => void): () => void;
}

export interface RealtimeRuntimeOptions {
  transport: RealtimeTransport;
  authorizeSubscription: (topic: unknown) => boolean;
  onEvent: (event: unknown) => void;
  onConnectionState?: (state: 'offline' | 'connecting' | 'online') => void;
}

export interface RealtimeRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(topic: unknown): Promise<void>;
  unsubscribe(topic: unknown): Promise<void>;
}

export function createRealtimeRuntime(opts: RealtimeRuntimeOptions): RealtimeRuntime;
```

Why this is good:

1. Reusable state machine.
2. Prevents every app from reinventing reconnect and ACK behavior.
3. Keeps app-specific cache invalidation outside package.

What stays app-local:

1. React Query invalidation mapping.
2. UX behavior on event receipt.

## 6.6 `@jskit/realtime-socketio-server`

Purpose:

1. Server-side realtime framework over Socket.IO.
2. Shared subscribe/unsubscribe/authorize/fanout patterns.
3. Plug in app authorization and publisher policy.

Likely extraction sources:

1. `server/realtime/registerSocketIoRealtime.js`
2. `server/domain/realtime/services/events.service.js`
3. `server/realtime/publishers/*`

Public API sketch:

```ts
export interface SocketActor {
  actorId: string;
  workspaceIds: string[];
}

export interface RealtimeServerDeps {
  authorizeConnection: (token: string) => Promise<SocketActor | null>;
  authorizeTopic: (actor: SocketActor, topic: unknown) => Promise<boolean>;
  publishPipeline?: (event: unknown) => Promise<unknown>;
}

export function registerSocketIoRealtime(io: unknown, deps: RealtimeServerDeps): void;
```

Why this is good:

1. High-value shared server infrastructure.
2. Keeps app-specific auth decisions injectable.
3. Reduces drift across apps in socket behavior.

What stays app-local:

1. Topic ownership rules.
2. Domain event production.

## 6.7 `@jskit/http-client-runtime`

Purpose:

1. Shared HTTP transport wrapper for frontend apps.
2. Support CSRF refresh retry, request correlation headers, auth token injection, consistent error normalization.

Likely extraction sources:

1. `src/services/api/transport.js`
2. Shared fetch/retry/header logic

Public API sketch:

```ts
export interface HttpClientOptions {
  baseUrl: string;
  getAuthToken?: () => string | null;
  getCsrfToken?: () => string | null;
  onAuthFailure?: () => Promise<void>;
  getCommandId?: () => string;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface HttpClient {
  request<T>(opts: HttpRequestOptions): Promise<T>;
}

export function createHttpClient(opts: HttpClientOptions): HttpClient;
```

Why this is good:

1. High reuse across all web apps.
2. Removes duplicated error and header boilerplate.
3. Better observability through consistent correlation IDs.

What stays app-local:

1. Endpoint-specific API methods.
2. Product-specific error UX.

## 6.8 `@jskit/billing-provider-core`

Purpose:

1. Shared provider interface for Stripe/Polar/etc.
2. Shared webhook translation contract.
3. Shared provider error types.

Likely extraction sources:

1. `server/modules/billing/providers/shared/providerAdapter.contract.js`
2. `server/modules/billing/providers/shared/webhookTranslation.contract.js`
3. `server/modules/billing/providers/shared/providerError.contract.js`
4. Provider registry patterns

Public API sketch:

```ts
export interface BillingProviderAdapter {
  providerCode: string;
  createCheckoutSession(input: unknown): Promise<{ url: string }>;
  cancelSubscription(input: unknown): Promise<void>;
  listPlans(input: unknown): Promise<unknown[]>;
}

export interface WebhookTranslator {
  translate(input: unknown): Promise<{
    type: string;
    occurredAt: string;
    data: unknown;
  } | null>;
}

export class BillingProviderError extends Error {
  public code: string;
  public retriable: boolean;
  constructor(message: string, code: string, retriable: boolean);
}
```

Why this is good:

1. Billing providers vary but lifecycle is similar.
2. Contract-level extraction avoids duplicating integrations.
3. Safe because persistence remains app-local.

What stays app-local:

1. Product pricing catalog.
2. Entitlement mapping to product plans.

## 6.9 `@jskit/entitlements-core`

Purpose:

1. Central entitlement engine with deterministic semantics.
2. Supports grants, consumption, balances, recompute, effective limitation resolution.
3. Abstract persistence via repository interface.

Likely extraction sources:

1. `server/modules/billing/service.js` (logic only)
2. `server/modules/billing/policy.service.js` (policy helpers)
3. Domain rules that can be made storage-agnostic

Public API sketch:

```ts
export type SubjectType = 'workspace' | 'user' | 'organization';

export interface SubjectRef {
  type: SubjectType;
  id: string;
}

export interface EntitlementDefinition {
  code: string;
  kind: 'capacity' | 'feature-flag' | 'rate';
  resetPolicy: 'never' | 'billing-period' | 'daily';
}

export interface EntitlementGrant {
  definitionCode: string;
  subject: SubjectRef;
  amount: number;
  startsAt: string;
  endsAt?: string;
}

export interface EntitlementConsumption {
  definitionCode: string;
  subject: SubjectRef;
  amount: number;
  idempotencyKey: string;
  occurredAt: string;
}

export interface EntitlementsRepository {
  findDefinitionByCode(code: string): Promise<EntitlementDefinition | null>;
  listActiveGrants(subject: SubjectRef, at: string): Promise<EntitlementGrant[]>;
  findConsumptionByIdempotencyKey(key: string): Promise<EntitlementConsumption | null>;
  insertConsumption(event: EntitlementConsumption): Promise<void>;
  upsertBalance(input: {
    definitionCode: string;
    subject: SubjectRef;
    remaining: number;
    computedAt: string;
  }): Promise<void>;
}

export interface EntitlementsService {
  consume(input: EntitlementConsumption): Promise<{ accepted: boolean; remaining: number }>;
  grant(input: EntitlementGrant): Promise<void>;
  resolveEffectiveLimitations(subject: SubjectRef): Promise<Record<string, unknown>>;
  recompute(subject: SubjectRef, definitionCode?: string): Promise<void>;
}

export function createEntitlementsService(repo: EntitlementsRepository): EntitlementsService;
```

Why this is good:

1. This is the most leverage-heavy shared logic if done as core + adapter.
2. Business semantics are reusable across many SaaS apps.
3. Allows consistent behavior and bug fixes platform-wide.

Critical boundary:

1. No SQL in core package.
2. No product-specific definition codes hardcoded in core.
3. Everything app-specific is injected via config/policy hooks.

## 6.10 `@jskit/entitlements-knex-mysql` (Optional, Later)

Purpose:

1. Knex/MySQL repository implementation for `entitlements-core`.
2. Optional migration helpers.

Likely extraction sources:

1. `server/modules/billing/repository.js` (only generic SQL)

Public API sketch:

```ts
export interface KnexEntitlementsAdapterOptions {
  knex: unknown;
  tableNames?: {
    definitions?: string;
    grants?: string;
    consumptions?: string;
    balances?: string;
  };
}

export function createKnexEntitlementsRepository(
  opts: KnexEntitlementsAdapterOptions
): import('@jskit/entitlements-core').EntitlementsRepository;

export function createEntitlementsMigrations(opts?: { tablePrefix?: string }): {
  up: (knex: unknown) => Promise<void>;
  down: (knex: unknown) => Promise<void>;
};
```

Why this is good:

1. Reuses persistence plumbing where schema compatibility exists.
2. Keeps SQL concerns separate from domain logic.

When not to use:

1. If an app has materially different entitlement schema.
2. If app needs non-SQL persistence.

## 7. Dependency Rules (Must-Have)

Define allowed layers:

1. `packages/contracts/*` has no runtime dependencies on app layers.
2. `packages/*-core` can depend on contracts.
3. `packages/*-adapter` can depend on core.
4. `apps/*` can depend on all packages.
5. `apps/*` cannot be imported by packages.
6. Cross-app imports are forbidden.

Simple import rule matrix:

```text
contracts -> (none)
core      -> contracts
adapter   -> core, contracts
app       -> contracts, core, adapter
```

## 8. Monorepo Tooling Stack

Recommended stack:

1. `pnpm` workspaces for package management.
2. `turbo` for build/test/cache pipelines.
3. `changesets` for package versioning and release notes.
4. `typescript` project references.
5. `eslint` boundary rules.
6. `vitest` for package-level unit tests.

## 8.1 `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - apps/*/*
  - packages/*
  - packages/*/*
  - tooling/*
```

## 8.2 Root `package.json` Scripts

```json
{
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev --parallel",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "release": "changeset version && changeset publish"
  }
}
```

## 8.3 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^typecheck"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

## 8.4 `changeset` Config

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": ["@changesets/changelog-github", {"repo": "your-org/project-monorepo"}],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "restricted",
  "baseBranch": "main",
  "updateInternalDependencies": "minor",
  "ignore": []
}
```

## 9. Release Strategy

Use independent package versioning with semver.

Semver contract:

1. `patch`: bug fix, no API break.
2. `minor`: backward-compatible additions.
3. `major`: breaking API/behavior.

Release channels:

1. `latest`: stable production.
2. `next`: prerelease for integration validation.

If all apps are in same monorepo:

1. Apps can still consume workspace packages.
2. Keep package versions real and updated anyway.
3. This keeps future split simple and preserves release discipline.

## 10. CI/CD Model

CI goals:

1. Fast feedback for changed scope only.
2. Prevent boundary violations.
3. Publish only packages that changed.

Required checks per PR:

1. `lint`
2. `typecheck`
3. `test`
4. `dependency-boundary-check`
5. `changeset` presence for package API changes

Required checks on `main`:

1. publish package releases (if changesets exist)
2. build/deploy each affected app independently

## 11. Security And Secrets Model

1. Keep secrets per app deployment target.
2. Never centralize app production secrets in shared packages.
3. Sign packages where possible and enable provenance.
4. Scan dependencies and image artifacts on every main merge.

## 12. Database Strategy For Shared Packages

Policy:

1. Shared core packages define interfaces and domain rules.
2. Adapter packages implement DB specifics.
3. App packages own migration orchestration and schema lifecycle.

Why:

1. DB models diverge over time.
2. Heavy SQL in "generic" packages becomes brittle fast.
3. Interface boundaries keep portability while preserving performance.

## 13. Handling Entitlements Without Over-Abstraction

This is the most important tradeoff for your codebase.

Use three layers:

1. `entitlements-core` for deterministic domain operations.
2. `entitlements-knex-mysql` for reusable SQL adapter.
3. App layer for plan/product mapping and special policies.

Keep in core:

1. idempotent consumption workflow
2. grant and balance recomputation logic
3. effective-limit resolution semantics

Keep out of core:

1. hardcoded capability codes like `projects.max`
2. app-specific joins and ownership models
3. request transport assumptions

Performance guidance:

1. Repositories expose specialized query methods for critical paths.
2. Avoid generic "query builder wrappers" in core.
3. Keep transaction boundaries explicit and injectable.

## 14. Handling Permissions Without Over-Abstraction

Use two layers:

1. `rbac-core` for pure permission evaluation.
2. `fastify-auth-policy` for transport integration.

Keep policy local:

1. workspace membership resolution
2. console role assignment
3. cross-tenant exceptions

This balances reuse and local control.

## 15. Handling Realtime Without Over-Abstraction

Use three layers:

1. `realtime-contracts` for protocol and topic contracts.
2. `realtime-client-runtime` for client connection state machine.
3. `realtime-socketio-server` for server socket lifecycle.

Keep app-local:

1. event-to-cache invalidation mapping
2. domain event producers
3. app-specific topic authorization rules

## 16. Migration Roadmap

## Phase 0 (Week 0-1): Foundation

Deliverables:

1. Workspace layout created.
2. Build/test pipeline in turbo.
3. Boundary lint rules active.
4. Changesets configured.

Exit criteria:

1. Every app builds independently.
2. Cross-app import violations fail CI.

## Phase 1 (Week 1-3): Lowest-Risk Shared Contracts

Extract:

1. `@jskit/surface-routing`
2. `@jskit/realtime-contracts`
3. `@jskit/rbac-core`

Exit criteria:

1. 100% behavior parity in existing app tests.
2. No runtime regressions.

## Phase 2 (Week 3-6): Client Runtime Reuse

Extract:

1. `@jskit/http-client-runtime`
2. `@jskit/realtime-client-runtime`

Exit criteria:

1. Stable reconnect behavior.
2. Error normalization parity.
3. API calls carry standardized correlation headers.

## Phase 3 (Week 6-9): Server Runtime Reuse

Extract:

1. `@jskit/fastify-auth-policy`
2. `@jskit/realtime-socketio-server`

Exit criteria:

1. Route auth checks unchanged.
2. Realtime fanout and authorization parity.

## Phase 4 (Week 9-14): Billing Contracts + Entitlements Core

Extract:

1. `@jskit/billing-provider-core`
2. `@jskit/entitlements-core`

Exit criteria:

1. Entitlement behavior parity under regression test suite.
2. No p95 latency regression on key endpoints.

## Phase 5 (Optional, Week 14+): Shared SQL Adapter

Extract:

1. `@jskit/entitlements-knex-mysql`

Exit criteria:

1. At least two apps can use the adapter without schema hacks.
2. Adapter API remains stable across one release cycle.

## 17. Test Strategy Per Package

Minimum quality gate for each package:

1. Unit tests for all public functions.
2. Contract tests for adapter interfaces.
3. Compatibility tests in at least one real app.
4. Snapshot/API signature checks for exported surface.

For critical packages (`rbac`, realtime, entitlements):

1. Property-based tests for edge cases.
2. Concurrency tests where idempotency matters.
3. Failure-injection tests for transport retries.

## 18. Cross-App Upgrade Workflow

While apps are in one monorepo:

1. Update package version.
2. Run affected app test matrix.
3. Merge atomic change.

After apps split into separate repos:

1. Publish package release.
2. Dependabot/Renovate opens update PRs in each app repo.
3. Use staged rollout from low-risk apps to high-risk apps.

## 19. Repo Split Playbook (Later)

When a specific app should move out:

1. Ensure app has no direct imports from sibling apps.
2. Ensure all shared logic comes from `@jskit/*` packages.
3. Extract app history into new repo (`git filter-repo` or subtree split).
4. Replace workspace package refs with registry versions.
5. Keep package names unchanged.

Example commands:

```bash
# Example only
# Extract app path history into standalone repository

git clone git@github.com:your-org/project-monorepo.git saas-a-repo
cd saas-a-repo
git filter-repo --path apps/saas-a --path-rename apps/saas-a/:./
```

## 20. Governance Rules

1. Every shared package must have a `README` with scope and non-goals.
2. Every package must define owner(s) in `CODEOWNERS`.
3. API changes require a changeset and migration note.
4. Breaking changes require a migration guide and upgrade script if feasible.
5. Add ADRs for major boundary decisions.

## 21. Anti-Patterns To Avoid

1. Utility dumping ground packages (`@jskit/common` with no boundaries).
2. Embedding app DB schema assumptions in core packages.
3. Re-exporting private internals as public API by accident.
4. Forcing all apps to adopt new features synchronously.
5. Building abstraction before two real use cases exist.

## 22. Practical Checklist Before Creating Any New Shared Package

Create a new package only if all are true:

1. There is clear reuse across at least two apps or near-term certainty.
2. Public API can be described in less than one page.
3. Package has explicit extension points.
4. Package has at least one contract test.
5. Package has defined non-goals.

If any item is false, keep code app-local for now.

## 23. Suggested Initial Package Creation Order

1. `@jskit/surface-routing`
2. `@jskit/realtime-contracts`
3. `@jskit/rbac-core`
4. `@jskit/http-client-runtime`
5. `@jskit/realtime-client-runtime`
6. `@jskit/fastify-auth-policy`
7. `@jskit/realtime-socketio-server`
8. `@jskit/billing-provider-core`
9. `@jskit/entitlements-core`
10. `@jskit/entitlements-knex-mysql`

This order minimizes risk and delivers value early.

## 24. Final Recommendation

Yes, start with one mega monorepo now.

Do not postpone package boundaries. Define them immediately.

If you do this, you get:

1. fast early velocity with atomic changes
2. platform-level reuse via npm-style packages
3. controlled upgrades across many apps
4. low-friction future split from one repo to many

If you skip boundaries now, future split will be expensive and error-prone.

## 25. Immediate Next Actions

1. Create `apps/` and `packages/` structure exactly as defined.
2. Add workspace, turbo, and changesets configs.
3. Turn on boundary lint rules before new features are added.
4. Extract first three low-risk packages in Phase 1.
5. Measure CI duration and package adoption metrics after each phase.

