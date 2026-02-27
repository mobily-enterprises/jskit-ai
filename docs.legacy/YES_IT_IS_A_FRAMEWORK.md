# YES_IT_IS_A_FRAMEWORK

Status: proposed master migration plan  
Scope: monorepo-wide (`apps/jskit-value-app` + `packages/**`)  
Audience: maintainers, core contributors, package authors, extension authors  
Primary objective: move from statically wired app composition to a real framework model where modules are self-contained, optional when intended, and composable by contract.

---

## 1) Executive Outcome

When this plan is complete, this repository will behave like a framework with explicit module composition instead of a single app with hardcoded injection points.

The end state is:

1. A tiny kernel composes modules from typed descriptors.
2. Every module contributes through explicit hooks (routes, services, controllers, actions, client routes/nav/api/realtime policies, workers, docs, config, migrations).
3. Optional modules can be disabled or omitted and disappear cleanly.
4. Dependency rules are validated at install and runtime.
5. URL mounts are configurable without per-module route rewrites.
6. Third-party/user-contributed modules are supported through a stable SDK contract.
7. Core/foundation modules are explicit and enforced by profile.

---

## 2) Current State Diagnosis (What Must Change)

Current composition is partially manifest-based, but still hardcoded and spread across many core files.

### 2.1 Hardcoded server composition points

- Runtime definitions are static arrays in app-owned core files:
  - `apps/jskit-value-app/server/runtime/repositories.js`
  - `apps/jskit-value-app/server/runtime/services.js`
  - `apps/jskit-value-app/server/runtime/controllers.js`
- Route modules are statically imported and manually listed:
  - `apps/jskit-value-app/server/modules/api/routes.js`
- Action contributors are manually listed:
  - `apps/jskit-value-app/server/runtime/actions/contributorManifest.js`

### 2.2 Hardcoded client composition points

- Client API object statically imports domain APIs:
  - `apps/jskit-value-app/src/platform/http/api/index.js`
- Router factory hardcodes which feature routes can exist:
  - `apps/jskit-value-app/src/app/router/factory.js`
  - `apps/jskit-value-app/src/app/router/app.js`
  - `apps/jskit-value-app/src/app/router/admin.js`
- Shell navigation hardcodes feature menu visibility logic:
  - `apps/jskit-value-app/src/app/shells/app/useAppShell.js`
  - `apps/jskit-value-app/src/app/shells/admin/useAdminShell.js`

### 2.3 Feature toggle vs true optionality

- `social.enabled` currently disables behavior mostly by returning 404 in service paths, but the module is still wired into core runtime and route composition.
- This is runtime gating, not install-time or composition-time optionality.

### 2.4 Cross-cutting registries patched by feature additions

- Realtime event/topic registries require core edits:
  - `apps/jskit-value-app/shared/eventTypes.js`
  - `apps/jskit-value-app/shared/topicRegistry.js`
- Bootstrap schema and store normalize fixed feature keys:
  - `apps/jskit-value-app/server/modules/workspace/schemas/bootstrap.schema.js`
  - `apps/jskit-value-app/src/app/state/workspaceStore.js`

### 2.5 Consequence

Adding/removing a feature module currently requires touching many core files, which violates the self-contained module goal.

---

## 3) Design Principles (Non-Negotiable)

1. Explicit registration, no magical global auto-discovery.
2. Declarative module descriptor + typed hooks.
3. Deterministic composition order.
4. Fail-fast validation for duplicate IDs, route collisions, missing deps, capability mismatch.
5. Keep app policy ownership in app layer (surface/workspace/auth alignment).
6. Preserve existing seam contracts while introducing framework composition.
7. Backward-compatible migration by phases, no flag day rewrite.
8. Optional modules vanish structurally when disabled.
9. Compatibility adapters/shims/surfaces are temporary migration scaffolding only and must be fully removed by final cutover.

---

## 4) End-State Architecture

## 4.1 Kernel vs Modules

### Kernel (minimal, non-removable)

Kernel owns only these responsibilities:

- module loading
- dependency graph validation
- URL mount resolution
- hook execution pipeline
- conflict detection
- lifecycle orchestration
- profile enforcement (required modules)

Kernel does **not** own business features.

### Modules

Each feature/platform component becomes a module contributor through one descriptor contract.

---

## 4.2 Module Descriptor Contract

Create a new shared package:

- `packages/runtime/module-framework-core`

Exports:

- `defineModule(descriptor)`
- descriptor schema validation
- dependency/capability validator
- route and hook conflict validators
- composition engine

Proposed descriptor:

```ts
export type ModuleTier = "kernel" | "foundation" | "feature" | "extension";

export interface ModuleDescriptor {
  id: string; // unique: "social", "chat", "billing", ...
  version: string; // semver for contract compatibility checks
  tier: ModuleTier;

  // install/runtime dependency declarations
  dependsOnModules?: Array<{ id: string; range?: string; optional?: boolean }>;
  requiresCapabilities?: Array<{ id: string; range?: string; optional?: boolean }>;
  providesCapabilities?: Array<{ id: string; version: string }>;

  // activation
  enabled?: (ctx: EnablementContext) => boolean;
  profilePolicy?: {
    requiredInProfiles?: string[]; // e.g. ["web-saas"]
    forbiddenInProfiles?: string[];
  };

  // URL customization
  mounts?: Array<{
    key: string; // e.g. "social.workspace"
    defaultPath: string; // e.g. "/social"
    surface?: "app" | "admin" | "console" | "global";
    allowOverride?: boolean;
    aliases?: string[];
  }>;

  // configuration contract
  config?: {
    schema: unknown;
    defaults: Record<string, unknown>;
    env?: Array<{ key: string; requiredWhen?: (cfg: any) => boolean }>;
    migrate?: (legacyConfig: any) => any;
  };

  // server hooks
  server?: {
    repositories?: HookRepositoryDefinitions;
    services?: HookServiceDefinitions;
    controllers?: HookControllerDefinitions;
    routes?: HookRouteDefinitions;
    fastifyPlugins?: HookFastifyPlugins;
    actions?: HookActionContributors;
    realtimeTopics?: HookRealtimeTopicRules;
    workers?: HookWorkerRuntimeServices;
    migrations?: HookMigrations;
    seeds?: HookSeeds;
    docs?: HookApiDocsFragments;
  };

  // client hooks
  client?: {
    api?: HookClientApiFragments;
    routes?: HookClientRoutes;
    guards?: HookClientGuards;
    nav?: HookClientNavigation;
    realtime?: HookClientRealtimeInvalidation;
    featureFlags?: HookClientFeatureFlags;
  };

  // app/bootstrap features contract
  appFeatures?: (ctx: AppFeatureContext) => Record<string, unknown>;

  // diagnostics and health
  diagnostics?: {
    startupChecks?: HookStartupChecks;
    healthChecks?: HookHealthChecks;
  };
}
```

---

## 4.3 URL Customization Model (First-Class)

URL customization is resolved at composition time, not by hardcoding paths in each module.

### 4.3.1 Route mount strategy

Modules declare mount keys and relative route templates.

Example:

- mount key: `social.workspace`
- default path: `/social`
- relative route: `/feed`
- effective route: `/api/v1/workspace{mount}/feed`

### 4.3.2 Central URL policy

Define:

- `apps/jskit-value-app/config/urls.js` (or merge into module config root)

```js
export const urlMountOverrides = {
  "social.workspace": "/community",
  "projects.workspace": "/customers",
  "billing.workspace": "/commerce"
};
```

### 4.3.3 URL collision checks

On boot:

1. resolve effective mounts
2. normalize and canonicalize
3. detect collisions and overlapping reserved paths
4. fail startup with deterministic diagnostics

### 4.3.4 URL alias/redirect support

Each mount can define aliases for migration windows.

- old: `/social`
- new: `/community`
- alias retained for N releases with deprecation header/log

### 4.3.5 Client/server path source unification

Generated path map is shared by:

- server route builders
- client router builders
- navigation links
- API clients
- docs contract generator

No duplicated hardcoded strings.

---

## 4.4 Dependency Model (Install-Time + Runtime)

## 4.4.1 Install-time dependencies

Keep `package.json` dependencies as package manager truth.

Add validation command:

- `npm run framework:deps:check`

It validates:

- declared module package exists
- version satisfies required range
- peer requirements resolved

## 4.4.2 Runtime dependency graph

Module framework builds graph from `dependsOnModules` and `requiresCapabilities`.

Rules:

1. topological sort required
2. cyclic deps are fatal
3. required missing dep is fatal in strict mode
4. optional missing dep disables dependent feature hooks gracefully
5. capability version mismatch is fatal in strict mode

## 4.4.3 Strict vs permissive boot

- production default: `strict`
- local dev option: `permissive`

Behavior:

- strict: fail startup when required dep missing
- permissive: disable affected module, expose diagnostics endpoint + warning banners

---

## 4.5 Core/Foundation/Feature/Extension Tiers

### Kernel

- `runtime/module-framework-core` (new)

### Foundation (required for app profile `web-saas`)

- auth identity/session
- RBAC permissions
- workspace tenancy resolution
- HTTP contract + route policy enforcement
- runtime composition + config/env policy
- observability baseline

### Feature (optional by profile/config)

- social
- chat
- billing
- ai
- communications
- console errors UI, etc.

### Extension (third-party/user-contributed)

- module SDK-compliant packages
- gated by permissions, capabilities, and optionally sandbox policy

---

## 4.6 Third-Party/User-Contributed Modules

Yes, this architecture supports community modules.

### Requirements to support safely

1. Stable Module SDK package.
2. Versioned descriptor contract.
3. Capability declaration/validation.
4. Lint + contract test harness for module authors.
5. Security policy:
   - trusted mode: in-process (internal/private modules)
   - untrusted mode (future): out-of-process with RPC boundary

### Minimal authoring lifecycle

1. `jskit module init`
2. implement descriptor + hooks
3. run `jskit module validate`
4. publish package
5. app registry opts in explicitly

---

## 4.7 End-State Composition Pipeline

Boot sequence:

1. load config/env/profile
2. load module registry entries
3. evaluate enablement predicates
4. resolve URLs and mounts
5. validate deps and capabilities
6. sort module order
7. execute composition phases:
   - repositories
   - services
   - controllers
   - routes
   - actions
   - realtime rules
   - worker runtimes
   - client composition artifacts
8. run startup diagnostics
9. expose composed runtime

---

## 5) Concrete Migration Strategy (From Here to End State)

Migration is split into deterministic phases to avoid breaking production behavior.

## Phase 0: Baseline and Freeze

Objectives:

- freeze architecture-sensitive files while introducing framework scaffolding
- capture current behavior contracts

Actions:

1. Freeze edits in current composition hotspots except migration PRs:
   - `server/runtime/*.js`
   - `server/modules/api/routes.js`
   - `src/platform/http/api/index.js`
   - `src/app/router/*`
   - `shared/topicRegistry.js`, `shared/eventTypes.js`
2. Generate baseline snapshots:
   - route inventory (`docs:api-contracts`)
   - action inventory
   - realtime topic inventory
3. Record baseline test matrix and coverage.

Exit criteria:

- baseline snapshots committed
- no functional drift

## Phase 1: Introduce Module Framework Core

Create new package:

- `packages/runtime/module-framework-core`

Deliverables:

1. descriptor validator
2. dependency graph validator
3. mount resolver
4. hook execution engine
5. conflict detector (IDs, routes, topics, actions)
6. composition diagnostics structure

Testing:

- unit tests for all validators
- deterministic order tests
- strict vs permissive behavior tests

Exit criteria:

- framework core package green
- no app integration yet

## Phase 2: Build App-Level Module Registry

Create in app:

- `apps/jskit-value-app/server/framework/moduleRegistry.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.js`
- `apps/jskit-value-app/shared/framework/profile.js`

Initial registry includes wrappers around existing static behavior.

Deliverables:

1. explicit module entries for all current first-party modules
2. composition runner returns artifacts equivalent to existing static manifests
3. compatibility adapter layer so old code can read composed artifacts

Exit criteria:

- composition output parity with current runtime
- no endpoint regressions

## Phase 3: Convert Server Runtime Composition

Replace static manifests progressively.

3.1 repositories

- migrate from `server/runtime/repositories.js` into module hooks

3.2 services

- migrate from `server/runtime/services.js` into module hooks

3.3 controllers

- migrate from `server/runtime/controllers.js` into module hooks

3.4 routes

- migrate from `server/modules/api/routes.js` route module list into composed route fragments

3.5 actions

- migrate from `server/runtime/actions/contributorManifest.js` into module action hooks

3.6 fastify plugins and workers

- compose module-provided plugins and workers, including social raw body and outbox worker

Exit criteria:

- static arrays removed or reduced to compatibility wrappers
- runtime behavior unchanged

## Phase 4: Convert Client Composition

4.1 API fragments

- replace static `api` object assembly with module-provided API fragments

4.2 route fragments and guards

- module route hooks compose app/admin/console route trees

4.3 navigation fragments

- module nav hooks contribute menu items and destination labeling metadata

4.4 realtime invalidation fragments

- module realtime hook contributes topic invalidation strategy

Exit criteria:

- client no longer requires core edits to add feature route/API/nav

## Phase 5: URL Mount Customization Rollout

1. add mount keys for all route-owning modules
2. convert route definitions to use mount keys + relative templates
3. add URL override config
4. add collision detection
5. add alias redirect support
6. update docs and tests

Exit criteria:

- at least two modules verified with custom mount paths
- generated contracts reflect new mounts

## Phase 6: Dependency and Capability Enforcement

1. implement install-time dep checker command
2. implement runtime graph validation and error reporting
3. define capability catalog
4. map all modules to required/provided capabilities
5. add strict/permissive mode

Exit criteria:

- missing dependency behavior deterministic and documented

## Phase 7: Core Tiering and Profile Contracts

1. define profile `web-saas-default`
2. mark required foundation modules
3. ensure startup fails if required module missing
4. define optional module packs (e.g. `+social`, `+billing`, `+ai`)

Exit criteria:

- profile tests cover required/optional semantics

## Phase 8: Third-Party Module SDK

1. publish SDK package and docs
2. create validation CLI
3. add extension loader
4. add extension compatibility tests

Exit criteria:

- sample external module loaded through same pipeline

## Phase 9: Cleanup and Hard Cutover

1. remove obsolete static composition code
2. remove dead feature-specific branch logic in core files
3. remove all migration-era compatibility adapters/shims/surfaces
4. lock new contribution rules
5. update architecture docs as source of truth

Exit criteria:

- all module additions/removals happen via registry + descriptor only
- zero compatibility adapters/shims/surfaces remain

---

## 6) Detailed File-Level Work Plan

## 6.1 New packages/files

Create:

- `packages/runtime/module-framework-core/README.md`
- `packages/runtime/module-framework-core/package.json`
- `packages/runtime/module-framework-core/src/index.js`
- `packages/runtime/module-framework-core/src/descriptor.js`
- `packages/runtime/module-framework-core/src/dependencyGraph.js`
- `packages/runtime/module-framework-core/src/capabilityGraph.js`
- `packages/runtime/module-framework-core/src/mountResolver.js`
- `packages/runtime/module-framework-core/src/conflicts.js`
- `packages/runtime/module-framework-core/src/composeServer.js`
- `packages/runtime/module-framework-core/src/composeClient.js`
- `packages/runtime/module-framework-core/src/diagnostics.js`

Create app integration seams:

- `apps/jskit-value-app/server/framework/moduleRegistry.js`
- `apps/jskit-value-app/server/framework/composeRuntime.js`
- `apps/jskit-value-app/server/framework/composeRoutes.js`
- `apps/jskit-value-app/server/framework/composeActions.js`
- `apps/jskit-value-app/server/framework/composeRealtime.js`
- `apps/jskit-value-app/src/framework/moduleRegistry.js`
- `apps/jskit-value-app/src/framework/composeRouter.js`
- `apps/jskit-value-app/src/framework/composeApi.js`
- `apps/jskit-value-app/src/framework/composeNavigation.js`
- `apps/jskit-value-app/src/framework/composeRealtimeClient.js`

Create configuration/docs:

- `apps/jskit-value-app/config/urls.js`
- `docs/architecture/module-profiles.md`
- `docs/architecture/module-authoring.md`
- `docs/architecture/module-capabilities.md`

## 6.2 Existing files to refactor (high-impact)

Server core:

- `apps/jskit-value-app/server.js`
- `apps/jskit-value-app/server/runtime/index.js`
- `apps/jskit-value-app/server/runtime/platformModuleManifest.js`
- `apps/jskit-value-app/server/runtime/repositories.js`
- `apps/jskit-value-app/server/runtime/services.js`
- `apps/jskit-value-app/server/runtime/controllers.js`
- `apps/jskit-value-app/server/modules/api/routes.js`
- `apps/jskit-value-app/server/runtime/actions/contributorManifest.js`

Client core:

- `apps/jskit-value-app/src/platform/http/api/index.js`
- `apps/jskit-value-app/src/app/router/index.js`
- `apps/jskit-value-app/src/app/router/factory.js`
- `apps/jskit-value-app/src/app/router/app.js`
- `apps/jskit-value-app/src/app/router/admin.js`
- `apps/jskit-value-app/src/platform/realtime/realtimeRuntime.js`
- `apps/jskit-value-app/src/platform/realtime/realtimeEventHandlers.js`

Shared registries:

- `apps/jskit-value-app/shared/eventTypes.js`
- `apps/jskit-value-app/shared/topicRegistry.js`
- `apps/jskit-value-app/shared/actionIds.js`

Bootstrap feature schema/state:

- `apps/jskit-value-app/server/modules/workspace/schemas/bootstrap.schema.js`
- `apps/jskit-value-app/src/app/state/workspaceStore.js`

---

## 7) Module Descriptor Hook Taxonomy (Final)

Hooks are executed in phases with explicit signatures.

## 7.1 Server hooks

- `repositories(ctx) => Definition[]`
- `services(ctx) => Definition[]`
- `controllers(ctx) => Definition[]`
- `routes(ctx) => RouteModuleDefinition[]`
- `actions(ctx) => Contributor[]`
- `realtimeTopics(ctx) => TopicRule[]`
- `fastifyPlugins(ctx) => PluginRegistration[]`
- `workers(ctx) => RuntimeServiceId[]`
- `migrations(ctx) => MigrationSpec[]`
- `seeds(ctx) => SeedSpec[]`
- `docs(ctx) => ApiDocFragment[]`

## 7.2 Client hooks

- `api(ctx) => Record<string, ApiClient>`
- `routes(ctx) => ClientRouteFragment[]`
- `guards(ctx) => GuardFragment[]`
- `nav(ctx) => NavFragment[]`
- `realtime(ctx) => RealtimeFragment[]`
- `featureFlags(ctx) => Record<string, any>`

## 7.3 Policy hooks

- `startupChecks(ctx) => Diagnostic[]`
- `healthChecks(ctx) => Diagnostic[]`

---

## 8) Module Capabilities Catalog (Initial)

Capabilities decouple dependencies from exact module IDs.

Initial capabilities:

- `cap.auth.identity`
- `cap.auth.cookies`
- `cap.rbac.permissions`
- `cap.workspace.selection`
- `cap.workspace.membership`
- `cap.http.route-policy`
- `cap.http.contracts`
- `cap.realtime.publish`
- `cap.realtime.subscribe`
- `cap.action-runtime.execute`
- `cap.billing.entitlements`
- `cap.storage.avatar`
- `cap.storage.attachments`
- `cap.observability.metrics`
- `cap.observability.logs`

Every module in ledger must declare provided/required capabilities.

---

## 9) Core Decision: Can Core Be Tiny?

Yes, but with profile constraints.

### 9.1 The truly tiny core

Tiny core can be:

- composition engine
- config/env loader
- lifecycle manager
- diagnostics

### 9.2 For this SaaS app profile, required foundation still includes

- auth
- RBAC
- workspace resolver
- route policy enforcement
- runtime env policy
- observability baseline

So authentication is not optional for `web-saas-default` profile.

If a future anonymous profile is introduced (e.g. pure public site), that profile can define a different required foundation set.

---

## 10) Package-by-Package Migration Ledger (All 80 Packages)

This section is exhaustive. Every package gets a migration target and required work.

Legend:

- Tier: `K` kernel, `F` foundation, `T` feature, `X` extension-ready/tooling
- Hooks: key hooks each package contributes to

## 10.1 AI Agent family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/assistant-client-element` | T | `assistant-ui` | `client.routes`, `client.nav` | `assistant-client-runtime` | Expose UI fragment descriptor; remove hardcoded app route assumptions. |
| `@jskit-ai/assistant-client-runtime` | T | `assistant-client` | `client.api`, `client.realtime` | `web/http-client-runtime`, `assistant-contracts` | Export API/runtime fragment factory for module composer. |
| `@jskit-ai/assistant-contracts` | F | `assistant-contracts` | none (contracts) | `contracts/http-contracts` | Keep contract-only; add capability declaration metadata. |
| `@jskit-ai/assistant-core` | T | `assistant-core` | `server.services`, `server.actions` | `action-runtime-core`, provider capability | Replace direct env/policy assumptions with descriptor config schema. |
| `@jskit-ai/assistant-fastify-routes` | T | `assistant-api` | `server.controllers`, `server.routes` | `assistant-core`, `http-contracts` | Export route fragment using mount keys, no hardcoded `/api/...` literals. |
| `@jskit-ai/assistant-provider-openai` | T | `assistant-provider-openai` | `server.services` | provider core capability | Register as provider capability module; fail-fast when selected but missing key. |
| `@jskit-ai/assistant-transcript-explorer-client-element` | T | `assistant-transcripts-ui` | `client.routes` | `assistant-transcripts-core` | Contribute route/view fragments and optional nav item metadata. |
| `@jskit-ai/assistant-transcripts-core` | T | `assistant-transcripts-core` | `server.services`, `server.actions` | `assistant-transcripts-knex-mysql` | Convert to service/action hook contributor; expose migration/seed metadata if needed. |
| `@jskit-ai/assistant-transcripts-knex-mysql` | T | `assistant-transcripts-db` | `server.repositories`, `server.migrations` | `knex-mysql-core` | Move repository registration out of app static runtime file into module hook. |

## 10.2 Auth family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/access-core` | F | `access-core` | contracts/util only | none | Expose capability `cap.auth.identity` helpers; no direct app imports. |
| `@jskit-ai/auth-fastify-routes` | F | `auth-api` | `server.controllers`, `server.routes` | `auth-provider-*`, `http-contracts` | Register auth routes via module hook and mount-safe path resolver. |
| `@jskit-ai/auth-provider-supabase-core` | F | `auth-provider-supabase` | `server.services`, `server.actions` | env/runtime policy | Provide provider capability contract and startup checks. |
| `@jskit-ai/fastify-auth-policy` | F | `auth-policy` | `server.fastifyPlugins` | route policy capability | Become policy plugin contributor; remove app-coupled assumptions. |
| `@jskit-ai/rbac-core` | F | `rbac` | `server.services`, `diagnostics.startupChecks` | runtime-env-core | Expose manifest validation as startup diagnostics hook. |

## 10.3 Billing family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/billing-commerce-client-element` | T | `billing-commerce-ui` | `client.routes`, `client.nav` | `billing-service-core` | Provide UI fragments and capability requirements. |
| `@jskit-ai/billing-console-admin-client-element` | T | `billing-console-ui` | `client.routes` | `billing-service-core` | Contribute console/admin billing views via module routes hook. |
| `@jskit-ai/billing-core` | T | `billing-domain-core` | `server.services` | entitlements | Keep provider-agnostic logic; descriptor for config schema and capabilities. |
| `@jskit-ai/billing-fastify-routes` | T | `billing-api` | `server.controllers`, `server.routes` | `billing-service-core` | Migrate to mount-based route fragments and generated docs fragments. |
| `@jskit-ai/billing-knex-mysql` | T | `billing-db` | `server.repositories`, `server.migrations` | `knex-mysql-core` | Register repositories/migrations via module hooks. |
| `@jskit-ai/billing-plan-client-element` | T | `billing-plan-ui` | `client.routes` | billing contracts | Route/nav fragment contributions only when billing enabled. |
| `@jskit-ai/billing-provider-core` | T | `billing-provider-core` | `server.services` | billing-core | Define provider capability interface contract. |
| `@jskit-ai/billing-provider-paddle` | T | `billing-provider-paddle` | `server.services` | billing-provider-core | Register provider implementation capability. |
| `@jskit-ai/billing-provider-stripe` | T | `billing-provider-stripe` | `server.services` | billing-provider-core | Register provider implementation capability. |
| `@jskit-ai/billing-service-core` | T | `billing-service` | `server.services`, `server.actions`, `server.realtimeTopics` | billing-db, provider capability | Convert all services/actions to module hook exports. |
| `@jskit-ai/billing-worker-core` | T | `billing-workers` | `server.workers`, `server.services` | billing-service | Register background worker runtime services through worker hook. |
| `@jskit-ai/entitlements-core` | T | `entitlements-core` | `server.services` | none | Expose entitlement consumption capability. |
| `@jskit-ai/entitlements-knex-mysql` | T | `entitlements-db` | `server.repositories`, `server.migrations` | knex | Register through module db hooks. |

## 10.4 Chat family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/chat-client-element` | T | `chat-ui` | `client.routes`, `client.nav` | chat-client-runtime | Remove direct path assumptions; consume mount key for chat route. |
| `@jskit-ai/chat-client-runtime` | T | `chat-client` | `client.api`, `client.realtime` | http-client-runtime | Contribute API and realtime invalidation fragments. |
| `@jskit-ai/chat-contracts` | F | `chat-contracts` | contracts only | http-contracts | Keep as contract-only capability provider. |
| `@jskit-ai/chat-core` | T | `chat-core` | `server.services`, `server.actions` | chat-db, storage, workspace | Module descriptor for policy/config and action contributor. |
| `@jskit-ai/chat-fastify-adapter` | T | `chat-api` | `server.controllers`, `server.routes` | chat-core | Route fragments move to mount-based templates. |
| `@jskit-ai/chat-knex-mysql` | T | `chat-db` | `server.repositories`, `server.migrations` | knex | Repository hooks replace static runtime imports. |
| `@jskit-ai/chat-storage-core` | T | `chat-storage` | `server.services` | filesystem/cloud storage capability | Storage service provider registered by module hook. |

## 10.5 Communications family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/communications-contracts` | F | `communications-contracts` | contracts only | http-contracts | Keep transport-neutral contracts. |
| `@jskit-ai/communications-core` | T | `communications-core` | `server.services`, `server.actions` | provider core | Module-based service contribution and action contributor registration. |
| `@jskit-ai/communications-fastify-adapter` | T | `communications-api` | `server.controllers`, `server.routes` | communications-core | Provide route fragments with mount support. |
| `@jskit-ai/communications-provider-core` | T | `communications-provider-core` | `server.services` | none | Capability contract for email/sms providers. |
| `@jskit-ai/email-core` | T | `email-provider` | `server.services` | provider-core | Register email provider implementation capability. |
| `@jskit-ai/sms-core` | T | `sms-provider` | `server.services` | provider-core | Register SMS provider implementation capability. |

## 10.6 Contracts family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/http-contracts` | F | `http-contracts` | contracts only | none | Remain foundation contract module; provide route schema capability. |
| `@jskit-ai/realtime-contracts` | F | `realtime-contracts` | contracts only | none | Remain foundation; define topic rule schema validators. |

## 10.7 Observability family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/console-errors-client-element` | T | `console-errors-ui` | `client.routes` | observability-core | Add route/nav fragments for console surfaces. |
| `@jskit-ai/observability-core` | F | `observability-core` | `server.services`, `diagnostics.healthChecks` | none | Provide capability `cap.observability.metrics` and logger hooks. |
| `@jskit-ai/observability-fastify-adapter` | F | `observability-api` | `server.controllers`, `server.routes` | observability-core | Register metrics/health route fragments by module hook. |

## 10.8 Operations family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/redis-ops-core` | F | `redis-ops` | `diagnostics.startupChecks`, `server.services` | runtime-env-core | Expose startup guardrails as module diagnostics. |
| `@jskit-ai/retention-core` | T | `retention` | `server.workers`, `server.services` | knex, queue | Register retention workers through worker hook. |

## 10.9 Realtime family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/realtime-client-runtime` | F | `realtime-client` | `client.realtime` | realtime-contracts | Provide base client runtime capability and extension points. |
| `@jskit-ai/realtime-server-socketio` | F | `realtime-server` | `server.fastifyPlugins`, `server.services` | realtime-contracts | Register transport runtime via module plugin hook. |

## 10.10 Runtime family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/action-runtime-core` | F | `action-runtime` | `server.services` | rbac, observability | Keep as core execution engine capability provider. |
| `@jskit-ai/health-fastify-routes` | F | `health-api` | `server.controllers`, `server.routes` | observability-core | Route fragments contributed by health module. |
| `@jskit-ai/knex-mysql-core` | F | `knex-core` | `server.services` | none | DB primitives capability provider. |
| `@jskit-ai/platform-server-runtime` | F | `platform-runtime-bridge` | `server.services` | server-runtime-core | Refactor to consume module framework output instead of static bundles. |
| `@jskit-ai/runtime-env-core` | F | `runtime-env` | `server.services`, `diagnostics.startupChecks` | none | Module config/env validation hooks; app feature projection contract. |
| `@jskit-ai/server-runtime-core` | F | `server-runtime-core` | foundational helpers | none | Keep primitives; integrate with new composer helpers where appropriate. |

## 10.11 Security family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/security-audit-core` | F | `security-audit` | `server.services`, `server.actions` | observability | Register audit capability consumed by action runtime. |
| `@jskit-ai/security-audit-knex-mysql` | F | `security-audit-db` | `server.repositories`, `server.migrations` | knex | Repository registration through module hooks. |

## 10.12 Social family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/social-client-runtime` | T | `social-client` | `client.api`, `client.routes`, `client.realtime` | social-contracts, http-client-runtime | Route/API/realtime fragments must be fully modularized. |
| `@jskit-ai/social-contracts` | F | `social-contracts` | contracts only | http-contracts | Keep query keys + contracts exported as capability. |
| `@jskit-ai/social-core` | T | `social-core` | `server.services`, `server.actions`, `server.realtimeTopics` | social-db, chat identity capability | Convert all policy and federation wiring to module descriptor config and hooks. |
| `@jskit-ai/social-fastify-adapter` | T | `social-api` | `server.controllers`, `server.routes`, `server.docs` | social-core, http-contracts | Route fragments should use mount keys and support URL overrides. |
| `@jskit-ai/social-knex-mysql` | T | `social-db` | `server.repositories`, `server.migrations` | knex | Register repos/migrations through db hooks. |

## 10.13 Surface routing package

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/surface-routing` | F | `surface-routing` | `client.routes`, `server.services` | workspace/auth capabilities | Centralize mount/surface path generation and remove duplicated path logic. |

## 10.14 Tooling family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/app-scripts` | X | `framework-tooling` | CLI hooks (not runtime) | module-framework-core | Add commands: `module:init`, `module:validate`, `framework:deps:check`, `framework:compose:report`. |
| `@jskit-ai/config-eslint` | X | `lint-tooling` | CI tooling | none | Add rules enforcing module descriptor boundaries and ban hardcoded composition edits. |

## 10.15 Users family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/members-admin-client-element` | T | `members-ui` | `client.routes`, `client.nav` | workspace-service | Contribute members/admin UI fragments only when module enabled. |
| `@jskit-ai/profile-client-element` | T | `profile-ui` | `client.routes` | user-profile-core | Route fragment and nav contribution hooks. |
| `@jskit-ai/user-profile-core` | F | `user-profile` | `server.services` | storage capability | Service hooks for avatar/profile operations. |
| `@jskit-ai/user-profile-knex-mysql` | F | `user-profile-db` | `server.repositories`, `server.migrations` | knex | Repository registration through module hooks. |

## 10.16 Web family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/http-client-runtime` | F | `http-client` | `client.api` | web-runtime-core | Provide transport capability used by module API fragments. |
| `@jskit-ai/web-runtime-core` | F | `web-runtime` | client primitives | none | Keep as base capability package. |

## 10.17 Workspace family

| Package | Tier | Target Module | Hooks | Depends On | Migration Work |
| --- | --- | --- | --- | --- | --- |
| `@jskit-ai/console-errors-fastify-routes` | T | `console-errors-api` | `server.controllers`, `server.routes` | observability-core | Expose route fragments in console feature module. |
| `@jskit-ai/console-fastify-routes` | F | `console-api` | `server.controllers`, `server.routes` | workspace-console-service-core | Foundation console module route hooks. |
| `@jskit-ai/settings-fastify-routes` | F | `settings-api` | `server.controllers`, `server.routes` | workspace-service-core | Convert settings routes to mount-safe fragments. |
| `@jskit-ai/workspace-console-core` | F | `workspace-console-core` | contracts/model | rbac | Capability provider for console settings/models. |
| `@jskit-ai/workspace-console-knex-mysql` | F | `workspace-console-db` | `server.repositories`, `server.migrations` | knex | Register console repos via hooks. |
| `@jskit-ai/workspace-console-service-core` | F | `workspace-console-service` | `server.services`, `server.actions` | workspace-console-db | Action contributor + service hooks. |
| `@jskit-ai/workspace-fastify-adapter` | F | `workspace-api` | `server.controllers`, `server.routes` | workspace-service-core | Foundation route fragments including bootstrap/workspaces/select. |
| `@jskit-ai/workspace-knex-mysql` | F | `workspace-db` | `server.repositories`, `server.migrations` | knex | Core tenancy repositories hooked into module composition. |
| `@jskit-ai/workspace-service-core` | F | `workspace-service` | `server.services`, `server.actions`, `client.featureFlags` | workspace-db, rbac | Keep workspace bootstrap/permissions core and migrate fixed feature flags to composed map. |

---

## 11) App-Local Modules Ledger (Current `server/modules/*`)

These app-local modules also become descriptors or contribute to descriptors.

| App Module | Target Descriptor | Tier | Required Work |
| --- | --- | --- | --- |
| `api` | `api-composer` (internal) | F | Replace static route list with composed module route fragments. |
| `auth` | merged into `auth-api` | F | Keep seam compatibility, move composition ownership to registry. |
| `workspace` | `workspace-api`/`workspace-service` | F | Move bootstrap feature map to composed module features. |
| `console` | `console-api` | F | Register through module hooks. |
| `settings` | `settings-api` | F | Register routes/controller via module hooks. |
| `alerts` | `alerts` | T | Convert actions/routes/nav/realtime rules to module hooks. |
| `history` | `history` | T | Convert to module descriptor with action + route fragments. |
| `deg2rad` | `deg2rad` | T | Keep as feature module, not special-cased app feature manifest. |
| `projects` | `projects` | T | Route/action/realtime hooks + configurable mount key. |
| `chat` | `chat` | T | App seam reduced to module adapter wrapper only. |
| `social` | `social` | T | Fully modular; no core file edits needed for on/off/install/remove. |
| `billing` | `billing` | T | Register provider/workers/routes through hooks. |
| `ai` | `assistant` | T | Register actions/routes/services via hooks. |
| `communications` | `communications` | T | Module-provided route/service/actions. |
| `health` | `health` | F | Foundation health module via hooks. |

---

## 12) Migration of Feature Flags and Bootstrap Schema

Current bootstrap has fixed feature keys.

Target:

- bootstrap `app.features` becomes composed map from active modules
- schema accepts module feature map with controlled validation rules

### 12.1 Strategy

1. keep current fixed keys during transition
2. introduce `features.modules` map
3. migrate client guards/nav to module feature lookups
4. deprecate fixed keys once all internal modules moved

Example target bootstrap shape:

```json
{
  "app": {
    "tenancyMode": "team-single",
    "features": {
      "workspaceSwitching": false,
      "workspaceInvites": true,
      "workspaceCreateEnabled": true
    },
    "modules": {
      "chat": { "enabled": true, "mount": "/chat" },
      "social": { "enabled": false, "mount": "/community" },
      "billing": { "enabled": true, "provider": "stripe" }
    }
  }
}
```

---

## 13) Testing and Verification Strategy

## 13.1 New framework test suites

Add:

- module descriptor schema tests
- dependency graph tests
- capability validation tests
- URL collision and alias tests
- route/action/topic duplicate conflict tests
- strict/permissive mode tests
- composition order determinism tests

## 13.2 Profile matrix tests

Run suites for at least these profiles:

1. `core` (foundation only)
2. `core+chat`
3. `core+social`
4. `core+billing`
5. `full`

## 13.3 Existing required gates still run

From current rails:

- `npm --prefix ../.. run lint:architecture:client`
- `npm --prefix ../.. run test:architecture:client`
- `npm --prefix ../.. run test:architecture:shared-ui`
- app lint/test/client test
- API contracts check when routes change

## 13.4 Golden snapshots

Keep golden outputs for:

- route inventory
- action inventory
- realtime topic inventory
- module composition report

Any drift must be reviewed.

---

## 14) Release/Rollout Plan

## 14.1 Incremental release tracks

Track A: framework core and compatibility layer (no behavior change)  
Track B: server composition migration  
Track C: client composition migration  
Track D: URL customization and dependency enforcement  
Track E: extension SDK  
Track F: cleanup and hard cutover

## 14.2 Safe rollout rules

1. no phase merges without parity tests green
2. no simultaneous changes to module descriptors and kernel behavior in one PR
3. profile matrix must stay green
4. docs updated in same PR for contract changes

## 14.3 Rollback strategy

- keep compatibility adapter until final cutover
- enable runtime fallback flag to old composition during migration window
- if regression occurs, switch fallback and isolate offending module descriptor

---

## 15) Governance Rules After Cutover

1. New feature packages must ship a module descriptor.
2. Core composition files are closed to direct feature patching.
3. No new hardcoded route/action/topic registration in app core.
4. URL paths must use mount keys.
5. Dependencies must be declared in descriptor and package metadata.
6. Module additions require profile impact declaration.

---

## 16) Detailed Work Breakdown by Sprint (Suggested)

## Sprint 1

- build `module-framework-core`
- descriptor + graph validators
- initial tests

## Sprint 2

- app registry + compatibility wrappers
- composition report tooling

## Sprint 3

- server repository/service/controller composition migration

## Sprint 4

- route/action composition migration
- realtime topic composition migration

## Sprint 5

- client API/router/nav/realtime composition migration

## Sprint 6

- URL customization model and path generation unification

## Sprint 7

- dependency/capability strict/permissive modes

## Sprint 8

- third-party module SDK + validation CLI

## Sprint 9

- remove legacy static composition code
- finalize docs and governance

---

## 17) Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Descriptor contract churn | high | Version descriptor schema and keep adapters. |
| Route/path drift during mount migration | high | Golden route snapshots + alias redirects + staged rollout. |
| Hidden implicit dependencies | high | Capability graph + startup diagnostics + profile tests. |
| Over-flexible hook surface causing chaos | medium | Typed hooks only, no generic wildcard hooks. |
| Third-party module instability | medium | SDK validator + compatibility matrix + strict mode default in prod. |
| Performance overhead in composition | low | Compose once at startup, cache artifacts. |

---

## 18) Definition of Done (Program-Level)

This initiative is done when all statements are true:

1. All 80 packages are represented in module framework ledger and resolved through descriptor policy.
2. Adding/removing optional modules requires only registry/config changes, not core composition file edits.
3. URL mount overrides work for server + client + docs generation.
4. Dependency failures are deterministic with strict/permissive behavior.
5. Core/foundation profile rules are enforced at startup.
6. Third-party module SDK exists with validation tooling.
7. Legacy static composition paths and all migration compatibility shims are removed.
8. Architecture docs and CI guardrails enforce the new model.

---

## 19) Immediate Next Actions (First PR Sequence)

1. Create `packages/runtime/module-framework-core` with descriptor and graph validators.
2. Add composition report command to `@jskit-ai/app-scripts`.
3. Add app module registry with descriptors for foundation modules only (no behavior change).
4. Add parity tests comparing old and new route/action inventories.
5. Migrate one optional module end-to-end as pilot (`social`) using new descriptors/hook pipeline.

Pilot success criteria:

- social enabled: parity with current behavior
- social disabled: no social routes/actions/topics/nav/api fragments composed
- no edits needed in legacy core composition files for social toggling

---

## 20) Final Positioning

At the end of this plan, this repository is not just a SaaS app with reusable packages; it is a framework-driven product platform where modules are first-class units of composition, governance, and extensibility.

That is the intended meaning of this document name:

**YES_IT_IS_A_FRAMEWORK**.


---

## 21) Expanded Detailed Specification (Supersedes High-Level Summary)

This section expands every major area into implementation-level detail, including data contracts, execution order, failure semantics, and migration guardrails.

### 21.1 Composition runtime internals

The composition engine must produce one immutable `FrameworkComposition` object during startup and keep it in memory.

```ts
interface FrameworkComposition {
  metadata: {
    profileId: string;
    generatedAtIso: string;
    strictMode: boolean;
    activeModuleIds: string[];
    disabledModuleIds: string[];
    moduleOrder: string[];
  };

  urls: {
    mounts: Record<string, ResolvedMount>;
    aliases: Array<ResolvedAlias>;
    collisions: Array<CollisionIssue>;
  };

  server: {
    repositoryDefinitions: RuntimeDefinition[];
    serviceDefinitions: RuntimeDefinition[];
    controllerDefinitions: RuntimeDefinition[];
    routeModules: RouteModuleDefinition[];
    actionContributors: ActionContributor[];
    realtimeTopicRules: RealtimeTopicRule[];
    fastifyPlugins: FastifyPluginRegistration[];
    workerRuntimeServiceIds: string[];
    migrationSpecs: MigrationSpec[];
    seedSpecs: SeedSpec[];
    apiDocFragments: ApiDocFragment[];
  };

  client: {
    apiFragments: ClientApiFragment[];
    routeFragments: ClientRouteFragment[];
    guardFragments: ClientGuardFragment[];
    navFragments: ClientNavFragment[];
    realtimeFragments: ClientRealtimeFragment[];
    featureFlags: Record<string, any>;
  };

  diagnostics: {
    errors: DiagnosticIssue[];
    warnings: DiagnosticIssue[];
    moduleReports: Record<string, ModuleDiagnosticReport>;
  };
}
```

Rules:

1. Composition object is frozen (`Object.freeze`) recursively before exposure.
2. Any mutation attempt in runtime should throw in test mode.
3. Composition report must be serializable and printable by CLI.
4. Composition output must be deterministic for same inputs (profile + env + module set).

### 21.2 Hook phase order and lifecycle guarantees

Hook phases are strict and cannot be reordered by modules:

1. `config`
2. `mounts`
3. `repositories`
4. `services`
5. `controllers`
6. `routes`
7. `actions`
8. `realtimeTopics`
9. `fastifyPlugins`
10. `workers`
11. `clientApi`
12. `clientRoutes`
13. `clientGuards`
14. `clientNavigation`
15. `clientRealtime`
16. `diagnostics`

Per phase guarantees:

- Phase input includes only outputs from earlier phases.
- Module cannot call later phase artifacts.
- Every phase records per-module success/failure with elapsed time.

### 21.3 Hook errors and isolation

Error classes:

- `MODULE_DESCRIPTOR_INVALID`
- `MODULE_DEPENDENCY_MISSING`
- `MODULE_CAPABILITY_MISSING`
- `MODULE_HOOK_FAILED`
- `MODULE_CONFLICT_ROUTE`
- `MODULE_CONFLICT_ACTION`
- `MODULE_CONFLICT_TOPIC`
- `MODULE_CONFLICT_NAV`
- `MODULE_MOUNT_COLLISION`

Strict mode behavior:

- Any error class above is fatal.

Permissive mode behavior:

- Descriptor invalid remains fatal.
- Missing dependency/capability disables requesting module.
- Hook failure disables module if hook declared `isolation: "module"`; fatal otherwise.
- Conflicts are fatal unless marked as compatibility alias collisions that can be downgraded.

### 21.4 Compatibility envelope for existing runtime code

During migration, keep these adapter seams:

1. `composeRuntimeToLegacyPlatformBundle(composition.server)`
2. `composeRoutesToLegacyRouteList(composition.server.routeModules)`
3. `composeClientFragmentsToLegacyApiObject(composition.client.apiFragments)`

Delete adapters only in final cleanup phase after parity tests pass for 2 consecutive release cycles.

---

## 22) Expanded URL System Specification

### 22.1 URL vocabulary

- Mount key: stable symbolic name, never user-facing (example: `social.workspace.api`)
- Mount path: user-facing configured prefix (example: `/community`)
- Route template: relative path under mount (example: `/posts/:postId`)
- Effective path: resolved path used by router and docs
- Alias: deprecated previous effective path that should still resolve temporarily

### 22.2 Mount declaration contract

```ts
interface ModuleMount {
  key: string;
  scope: "api" | "page" | "public" | "socket";
  surface: "app" | "admin" | "console" | "global";
  defaultPath: string;
  allowOverride: boolean;
  reserved?: boolean;
  aliases?: string[];
  normalization?: {
    trailingSlash: "forbid" | "allow";
    case: "lower" | "preserve";
  };
}
```

Validation rules:

1. Path must start with `/`.
2. Path must not end with `/` unless root `/`.
3. Path cannot contain `//`.
4. Path cannot overlap reserved namespaces unless explicitly allowed.
5. Case normalization must be applied before collision checks.

### 22.3 Reserved namespaces

Reserved namespaces for this app profile:

- `/api`
- `/api/v1`
- `/api/v1/docs`
- `/api/v1/metrics`
- `/api/v1/health`
- `/api/v1/ready`
- `/admin`
- `/console`
- `/login`
- `/workspaces`
- `/.well-known`
- `/ap`

Rules:

- Feature modules cannot override reserved namespaces directly.
- Feature mounts under `/api/v1/workspace/*` and `/api/v1/console/*` are allowed if scoped.

### 22.4 URL override file structure

`apps/jskit-value-app/config/urls.js`

```js
export const urlConfig = {
  mounts: {
    "projects.workspace.page": "/customers",
    "social.workspace.page": "/community",
    "chat.workspace.page": "/workspace-chat"
  },
  aliases: {
    "social.workspace.page": ["/social"],
    "projects.workspace.page": ["/projects"]
  },
  redirects: {
    permanent: true,
    preserveQuery: true
  }
};
```

### 22.5 Alias lifecycle policy

Required fields for each alias:

- `introducedInVersion`
- `targetRemovalVersion`
- `reason`
- `owner`

Boot diagnostics should warn when current version reaches removal window.

### 22.6 URL resolution algorithm

```txt
INPUT: profile, module mounts, app url overrides
STEP 1 normalize all default mounts
STEP 2 apply overrides to overridable mounts
STEP 3 append aliases and normalize
STEP 4 compute canonical route map
STEP 5 detect exact collisions
STEP 6 detect prefix-shadow collisions where forbidden
STEP 7 emit resolved map + collision diagnostics
```

### 22.7 URL customization test matrix

Required tests:

1. default path generation for each module mount
2. override applied and reflected in server route list
3. override applied and reflected in client route tree
4. docs generation uses effective paths
5. alias redirect works and preserves query string
6. collision fails startup with clear error message

---

## 23) Expanded Dependency and Capability Specification

### 23.1 Dependency declarations

Modules declare both hard and soft dependencies:

```ts
dependsOnModules: [
  { id: "workspace-service", range: ">=1.0.0 <2.0.0", optional: false },
  { id: "realtime-server", range: ">=1.0.0", optional: true }
]
```

Hard dependency semantics:

- must be installed and enabled
- version must satisfy range

Soft dependency semantics:

- module can start without it
- dependent hooks needing soft dep must guard behavior and return no-op fragments

### 23.2 Capability declarations

`providesCapabilities` and `requiresCapabilities` are used when module identity should not be tightly coupled.

Example:

- billing service requires `cap.billing.provider`
- any provider module can satisfy it (`stripe`, `paddle`, future)

### 23.3 Dependency graph validation algorithm

1. Build module vertex set from active modules.
2. Validate unique module IDs.
3. Validate declared dependency IDs exist in known registry (or mark unresolved for permissive mode).
4. Build directed graph `module -> dependency`.
5. Detect cycles using DFS/Tarjan.
6. Resolve topological order.
7. Validate semver ranges against installed package versions.
8. Validate capability providers exist and satisfy ranges.
9. Emit deterministic module load order.

### 23.4 Missing dependency behavior matrix

| Mode | Missing hard dep | Missing soft dep | Version mismatch |
| --- | --- | --- | --- |
| strict | fatal startup error | warning + continue | fatal startup error |
| permissive | module disabled + warning | warning + continue | module disabled + warning |

### 23.5 Dependency diagnostics shape

```json
{
  "moduleId": "social",
  "severity": "error",
  "code": "MODULE_DEPENDENCY_MISSING",
  "message": "Required module workspace-service is not active.",
  "details": {
    "required": "workspace-service",
    "requiredRange": ">=1.0.0",
    "strictMode": true
  }
}
```

### 23.6 Install-time checker behavior

`framework:deps:check` command should:

1. read module registry
2. map module ID to package name
3. verify package is present in workspace lockfile
4. verify version ranges
5. print actionable missing install commands

---

## 24) Expanded Third-Party Module Model

### 24.1 Trust tiers

- `trusted-internal`: full hook access
- `trusted-partner`: full access with compatibility contract enforcement
- `untrusted`: future mode, restricted to out-of-process API hooks only

### 24.2 Extension restrictions for v1

For v1 third-party in-process support:

1. no direct mutation of existing module artifacts
2. no hook to replace core auth policy
3. route contributions must be namespaced under assigned mount prefix
4. permissions must be explicitly declared and namespaced
5. extension module IDs must use prefix `ext.<org>.<module>`

### 24.3 Extension packaging contract

Required files for extension package:

- `package.json`
- `module.descriptor.js`
- `README.md`
- `COMPATIBILITY.md`
- `tests/module.contract.test.js`

### 24.4 Extension validation CLI

`jskit module validate` checks:

1. descriptor schema validity
2. dependency and capability declarations
3. route/action/topic ID namespace compliance
4. no banned imports (app internals)
5. compatibility declaration against framework versions

---

## 25) Expanded Core Tier and Profile Model

### 25.1 Profiles

Introduce profile manifests:

- `apps/jskit-value-app/config/frameworkProfiles/web-saas-default.profile.js`
- `apps/jskit-value-app/config/frameworkProfiles/web-saas-social.profile.js`
- `apps/jskit-value-app/config/frameworkProfiles/web-saas-minimal.profile.js`

Profile fields:

```ts
interface FrameworkProfile {
  id: string;
  requiredModules: string[];
  optionalModules: string[];
  forbiddenModules?: string[];
  requiredCapabilities: string[];
  defaultModuleEnablement: Record<string, boolean>;
}
```

### 25.2 Default foundation set for current app

Must be required in `web-saas-default`:

- `runtime-env`
- `server-runtime-core`
- `http-contracts`
- `auth-provider-supabase`
- `auth-policy`
- `rbac`
- `workspace-db`
- `workspace-service`
- `workspace-api`
- `realtime-server`
- `realtime-client`
- `observability-core`
- `health-api`

### 25.3 Optional set examples

- social pack: `social-db`, `social-core`, `social-api`, `social-client`
- billing pack: `billing-db`, `billing-service`, `billing-api`, provider modules
- ai pack: `assistant-core`, provider module, transcript modules

### 25.4 Profile enforcement rules

1. Missing required module: fatal startup.
2. Forbidden module active: fatal startup.
3. Missing required capability: fatal startup.
4. Optional module with broken deps: disable in permissive, fail in strict.

---

## 26) Expanded Migration Program (PR-Level)

### 26.1 Phase 0 PR slices

PR-0.1 Baseline snapshots

- Add snapshot generators for routes/actions/topics
- Commit current snapshots

PR-0.2 Architecture freeze guardrails

- Add lint rule that blocks new static imports in composition hotspots

### 26.2 Phase 1 PR slices

PR-1.1 Create module framework package scaffold
PR-1.2 Add descriptor schema validator and tests
PR-1.3 Add dependency graph validator and tests
PR-1.4 Add mount resolver and collision checks
PR-1.5 Add composition diagnostics reporter

### 26.3 Phase 2 PR slices

PR-2.1 Add server module registry with no-op wrappers
PR-2.2 Add client module registry with no-op wrappers
PR-2.3 Add CLI composition report command
PR-2.4 Add compatibility adapter tests

### 26.4 Phase 3 PR slices (server)

PR-3.1 repositories composition from registry
PR-3.2 services composition from registry
PR-3.3 controllers composition from registry
PR-3.4 routes composition from route module fragments
PR-3.5 actions composition from contributor fragments
PR-3.6 realtime topic rules composition
PR-3.7 fastify plugin and worker composition

### 26.5 Phase 4 PR slices (client)

PR-4.1 api fragment composition
PR-4.2 route fragment composition
PR-4.3 guard fragment composition
PR-4.4 nav fragment composition
PR-4.5 realtime invalidation fragment composition

### 26.6 Phase 5 PR slices (URL)

PR-5.1 mount key declarations per module
PR-5.2 server route mount resolution
PR-5.3 client route mount resolution
PR-5.4 alias redirect and diagnostics
PR-5.5 docs contract generation from effective paths

### 26.7 Phase 6 PR slices (deps/capabilities)

PR-6.1 install-time dep checker command
PR-6.2 runtime strict/permissive modes
PR-6.3 capability catalog and resolver
PR-6.4 module compatibility tests

### 26.8 Phase 7 PR slices (profiles)

PR-7.1 profile manifest framework
PR-7.2 web-saas-default profile
PR-7.3 optional module packs and profile tests

### 26.9 Phase 8 PR slices (third-party)

PR-8.1 module authoring SDK docs
PR-8.2 module validation CLI
PR-8.3 sample external module in test fixture

### 26.10 Phase 9 PR slices (cleanup)

PR-9.1 remove legacy static composition arrays
PR-9.2 remove compatibility adapters
PR-9.3 enforce governance checks in CI

---

## 27) Expanded Test Plan and Required Commands

### 27.1 New command set

Add to root/app scripts:

- `framework:compose:report`
- `framework:deps:check`
- `framework:profiles:test`
- `framework:mounts:check`
- `framework:extensions:validate`

### 27.2 Required CI matrix

Dimensions:

- node versions: current supported set
- mode: strict vs permissive
- profiles: core, core+social, core+billing, full

### 27.3 Contract parity tests during migration

Must assert parity between legacy and framework composition for:

1. route inventory
2. action inventory
3. realtime topic inventory
4. exposed client route inventory
5. bootstrap app feature map

### 27.4 Regression tests for module off states

For each optional pack:

- all routes removed or return not found by non-registration
- no stale nav items
- no stale API clients on composed client object
- no startup plugin registration for disabled pack
- no background worker start for disabled pack

---

## 28) Expanded Operational Runbook

### 28.1 Startup diagnostics endpoint

Expose framework diagnostics in non-production:

- `GET /api/v1/framework/diagnostics`

Contains:

- active modules
- disabled modules and reasons
- resolved mounts
- dependency issues
- capability map

### 28.2 Observability metrics

Emit metrics:

- `framework.compose.duration_ms`
- `framework.active_modules.count`
- `framework.disabled_modules.count`
- `framework.conflicts.count`
- `framework.startup_diagnostics.errors`

### 28.3 Incident response

If startup fails due to module dependency issues:

1. run `framework:compose:report --strict`
2. inspect missing modules/capabilities
3. if urgent prod recovery needed, temporarily switch profile to disable affected optional module
4. capture postmortem with module dependency contract update

---

## 29) Expanded Governance and Review Checklist

Every module-affecting PR must include:

1. descriptor diff summary
2. dependency and capability impact
3. mount/path impact
4. profile impact
5. test matrix executed
6. docs updates

Mandatory reviewer roles:

- framework maintainer
- domain owner of changed module
- security reviewer for auth/policy/path changes

---

## 30) Expanded Detailed Package Execution Checklists (All 80 Packages)

Each checklist includes concrete actions for that package.

### 30.1 AI packages

#### 1) `@jskit-ai/assistant-client-element`

- Create `module.descriptor.js` exporting module `assistant-ui`.
- Move route contribution from app hardcoded router into `client.routes` fragment.
- Add nav fragment with permission and feature gating metadata.
- Ensure route path is mount-key based, not literal.
- Add component-level tests under profile with assistant enabled/disabled.
- Validate no direct import of app internals.

#### 2) `@jskit-ai/assistant-client-runtime`

- Export `createAssistantApiFragment` for composition.
- Export `createAssistantRealtimeFragment` for query invalidation.
- Add descriptor dependency on `http-client-runtime` and `assistant-contracts`.
- Support missing module dependencies with safe no-op in permissive mode.
- Add integration tests verifying fragment composition order independence.

#### 3) `@jskit-ai/assistant-contracts`

- Keep as contracts-only module.
- Publish capability `cap.assistant.contracts`.
- Add compatibility tests for schema stability.
- Add semver guard docs for breaking changes.

#### 4) `@jskit-ai/assistant-core`

- Convert config assumptions to descriptor config schema.
- Export action contributor through `server.actions` hook.
- Export service definitions through `server.services` hook.
- Declare required capabilities: `cap.action-runtime.execute`, `cap.workspace.selection`.
- Add startup checks for provider availability when enabled.

#### 5) `@jskit-ai/assistant-fastify-routes`

- Export route module fragments with mount keys.
- Ensure route options are provided by composer context (limits/permissions).
- Register controller factory through `server.controllers` hook.
- Add docs fragment generation hook.
- Add tests for mount path overrides.

#### 6) `@jskit-ai/assistant-provider-openai`

- Register provider capability `cap.assistant.provider`.
- Add strict startup checks for required env keys when active.
- Add deterministic provider selection logic with capability resolver.
- Add fallback diagnostics in permissive mode.

#### 7) `@jskit-ai/assistant-transcript-explorer-client-element`

- Contribute transcript route fragments for relevant surfaces.
- Contribute optional nav entries with permission checks.
- Validate route removal when module disabled.
- Add UI tests for enabled/disabled profile states.

#### 8) `@jskit-ai/assistant-transcripts-core`

- Export transcript service hook and action contributor hook.
- Move any static IDs into descriptor-provided IDs.
- Add capability dependency on transcripts repository module.
- Add action catalog parity tests.

#### 9) `@jskit-ai/assistant-transcripts-knex-mysql`

- Export repository definition hook.
- Export migration spec hook.
- Add DB schema contract tests and migration idempotency checks.
- Ensure module can be absent without breaking foundation profile.

### 30.2 Auth packages

#### 10) `@jskit-ai/access-core`

- Keep utility-only.
- Publish capability `cap.auth.identity.utils`.
- No runtime hooks except contract metadata.
- Add compatibility tests for path/return-to normalization behavior.

#### 11) `@jskit-ai/auth-fastify-routes`

- Export auth route fragments via `server.routes`.
- Export controller hook.
- Refactor route paths to mount keys where relevant.
- Confirm CSRF/rate-limit metadata remains route-level and composable.

#### 12) `@jskit-ai/auth-provider-supabase-core`

- Export auth service hook.
- Export auth action contributor hook.
- Declare env schema in descriptor.
- Add strict startup validation for required keys.
- Expose capability `cap.auth.identity` and `cap.auth.cookies`.

#### 13) `@jskit-ai/fastify-auth-policy`

- Export fastify policy plugin via `server.fastifyPlugins`.
- Define composable route policy merge contract.
- Add tests verifying policy consistency with composed routes.
- Ensure no direct assumptions about hardcoded route groups.

#### 14) `@jskit-ai/rbac-core`

- Export RBAC manifest loader/validator startup check hook.
- Expose capability `cap.rbac.permissions`.
- Add diagnostics payload for missing permissions used by modules.

### 30.3 Billing packages

#### 15) `@jskit-ai/billing-commerce-client-element`

- Contribute billing commerce UI routes via fragments.
- Contribute nav item fragments.
- Ensure mount overrides reflected in generated links.
- Add profile tests where billing disabled.

#### 16) `@jskit-ai/billing-console-admin-client-element`

- Contribute console/admin billing routes via fragments.
- Ensure permission checks remain declarative in fragment metadata.
- Add route guard integration tests.

#### 17) `@jskit-ai/billing-core`

- Export billing domain service hooks.
- Declare required capabilities for providers and entitlements.
- Add fail-closed behavior tests under missing provider.

#### 18) `@jskit-ai/billing-fastify-routes`

- Export route/controller hooks.
- Replace literal paths with mount keys.
- Contribute docs fragments for route inventory generator.
- Add webhook route policy regression tests.

#### 19) `@jskit-ai/billing-knex-mysql`

- Export billing repositories through hook.
- Export billing migrations and migration ownership metadata.
- Add migration backward compatibility tests.

#### 20) `@jskit-ai/billing-plan-client-element`

- Contribute plan UI route fragments.
- Add nav integration metadata.
- Validate hidden state when billing not enabled.

#### 21) `@jskit-ai/billing-provider-core`

- Define provider capability interface and registry hook.
- Add compatibility tests for provider adapters.
- Add diagnostics for unresolved provider IDs.

#### 22) `@jskit-ai/billing-provider-paddle`

- Register provider implementation capability.
- Add env startup checks via descriptor.
- Add provider integration tests for capability registration.

#### 23) `@jskit-ai/billing-provider-stripe`

- Register provider implementation capability.
- Add env startup checks via descriptor.
- Add provider integration tests for capability registration.

#### 24) `@jskit-ai/billing-service-core`

- Export service hooks and action contributor hooks.
- Export realtime topic rules through hook.
- Ensure all billing action IDs come from composed action registry.
- Add strict fail-closed tests for disabled billing profile.

#### 25) `@jskit-ai/billing-worker-core`

- Export worker runtime hooks.
- Ensure worker starts only when billing module active.
- Add startup/shutdown lifecycle tests via composed worker registry.

#### 26) `@jskit-ai/entitlements-core`

- Export entitlements service capability.
- Add dependency contract tests with billing-service.
- Ensure no app-level direct static wiring required.

#### 27) `@jskit-ai/entitlements-knex-mysql`

- Export entitlements repositories and migrations via hooks.
- Add DB migration contract tests.
- Validate module-off state yields no repo registration.

### 30.4 Chat packages

#### 28) `@jskit-ai/chat-client-element`

- Contribute chat routes/nav through fragments.
- Use configurable mount key for workspace chat page.
- Add profile tests for chat-enabled and chat-disabled.

#### 29) `@jskit-ai/chat-client-runtime`

- Export API and realtime invalidation fragments.
- Depend on `http-client-runtime` capability.
- Add tests for fragment merge with social and assistant.

#### 30) `@jskit-ai/chat-contracts`

- Keep contracts-only.
- Provide capability `cap.chat.contracts`.
- Add semver schema lock tests.

#### 31) `@jskit-ai/chat-core`

- Export service and action contributor hooks.
- Remove app static composition dependencies.
- Declare required capabilities: workspace membership, attachments storage.
- Add action route parity tests.

#### 32) `@jskit-ai/chat-fastify-adapter`

- Export route/controller hooks with mount keys.
- Add configurable limits via hook options from composed config.
- Add route metadata and policy alignment tests.

#### 33) `@jskit-ai/chat-knex-mysql`

- Export repositories + migrations via hooks.
- Add migration ownership metadata.
- Ensure module-off state does not create chat repos.

#### 34) `@jskit-ai/chat-storage-core`

- Export storage service hook.
- Define storage capability provider interface.
- Add startup diagnostics for misconfigured storage driver.

### 30.5 Communications packages

#### 35) `@jskit-ai/communications-contracts`

- Keep as contract module with capability declaration.
- Add compatibility schema tests.

#### 36) `@jskit-ai/communications-core`

- Export service and action hooks.
- Declare provider capability dependencies.
- Add behavior tests for provider missing in strict/permissive modes.

#### 37) `@jskit-ai/communications-fastify-adapter`

- Export route/controller fragments.
- Convert any static path assumptions to mount keys.
- Add docs fragment integration tests.

#### 38) `@jskit-ai/communications-provider-core`

- Define provider interface capability contract.
- Add capability resolver tests.
- Add diagnostics for unresolved provider alias.

#### 39) `@jskit-ai/email-core`

- Export email provider service hook.
- Register provider capability.
- Add config schema validation tests.

#### 40) `@jskit-ai/sms-core`

- Export sms provider service hook.
- Register provider capability.
- Add config schema validation tests.

### 30.6 Contract packages

#### 41) `@jskit-ai/http-contracts`

- Keep foundation contract package.
- Add helper for route fragment schema registration.
- Add test coverage for composed schema aggregation.

#### 42) `@jskit-ai/realtime-contracts`

- Keep foundation contract package.
- Add helper for composed topic catalog validation.
- Add tests for merged topic registry semantics.

### 30.7 Observability packages

#### 43) `@jskit-ai/console-errors-client-element`

- Contribute console error routes/nav fragments.
- Add module-off visibility tests.
- Ensure no hardcoded console route assumptions.

#### 44) `@jskit-ai/observability-core`

- Export observability service hook.
- Export startup and health diagnostic hooks.
- Add capability declarations for logging and metrics.

#### 45) `@jskit-ai/observability-fastify-adapter`

- Export metrics/observability routes via hooks.
- Ensure route registration respects profile and env policy.
- Add contract tests for docs generation and auth policy.

### 30.8 Operations packages

#### 46) `@jskit-ai/redis-ops-core`

- Export startup diagnostics hook for rate-limit redis policy.
- Export redis helper services as capabilities.
- Add strict-mode error tests for prod misconfiguration.

#### 47) `@jskit-ai/retention-core`

- Export worker hooks and service hooks.
- Add lifecycle tests for worker start/stop under profile toggles.
- Add diagnostics and dead-letter operational hooks.

### 30.9 Realtime packages

#### 48) `@jskit-ai/realtime-client-runtime`

- Export client realtime runtime capability hook.
- Allow module realtime fragments to register strategies.
- Add tests for merged topic strategy behavior.

#### 49) `@jskit-ai/realtime-server-socketio`

- Export server plugin/service hooks.
- Integrate composed topic policy callbacks.
- Add startup diagnostics for adapter availability.

### 30.10 Runtime packages

#### 50) `@jskit-ai/action-runtime-core`

- Keep as foundation engine.
- Add support for composed contributor array from modules.
- Add duplicate action detection tests with module metadata context.

#### 51) `@jskit-ai/health-fastify-routes`

- Export route/controller hooks.
- Add profile-aware enablement defaults.
- Ensure always active in required profiles.

#### 52) `@jskit-ai/knex-mysql-core`

- Keep foundation DB primitives.
- Add migration metadata helpers for module migration hooks.
- Add test helpers for module db contracts.

#### 53) `@jskit-ai/platform-server-runtime`

- Refactor to accept composed framework definitions directly.
- Preserve backward compatibility adapter temporarily.
- Add parity tests between legacy and framework inputs.

#### 54) `@jskit-ai/runtime-env-core`

- Export config/env schema utilities for module descriptors.
- Support composed feature map projection.
- Add tests for merged module config validation.

#### 55) `@jskit-ai/server-runtime-core`

- Keep core primitives.
- Add helpers for route/module conflict normalization.
- Add stable utilities consumed by module-framework-core.

### 30.11 Security packages

#### 56) `@jskit-ai/security-audit-core`

- Export audit service hook.
- Integrate with composed action runtime adapters.
- Add per-module audit tagging conventions.

#### 57) `@jskit-ai/security-audit-knex-mysql`

- Export audit repository and migrations via hooks.
- Add retention and migration tests.
- Ensure module is required in default profile if audit mandatory.

### 30.12 Social packages

#### 58) `@jskit-ai/social-client-runtime`

- Export client API fragment.
- Export route and nav fragments.
- Export realtime invalidation fragments.
- Ensure everything disappears structurally when disabled.
- Add profile tests verifying no social routes/nav/api objects when off.

#### 59) `@jskit-ai/social-contracts`

- Keep contracts-only module.
- Publish social capability IDs.
- Add schema and query key compatibility tests.

#### 60) `@jskit-ai/social-core`

- Export social service hook.
- Export action contributor hook.
- Export realtime topic hook.
- Export worker requirements hook.
- Keep 404 behavior only as defense-in-depth; composition should remove routes when disabled.

#### 61) `@jskit-ai/social-fastify-adapter`

- Export route/controller/doc hooks.
- Convert hardcoded route paths to mount template inputs.
- Keep federation public routes under protected reserved namespace policy.
- Add tests for alias and mount customization.

#### 62) `@jskit-ai/social-knex-mysql`

- Export social repositories and migrations via hooks.
- Add migration ownership and order metadata.
- Add module-off db wiring tests.

### 30.13 Surface routing package

#### 63) `@jskit-ai/surface-routing`

- Promote as foundation for path derivation.
- Add APIs for module mount resolution per surface.
- Replace duplicated local route-path helpers in app with package usage.
- Add comprehensive tests for surface and workspace slug path generation.

### 30.14 Tooling packages

#### 64) `@jskit-ai/app-scripts`

- Add module tooling commands:
  - `module:init`
  - `module:validate`
  - `framework:deps:check`
  - `framework:compose:report`
  - `framework:profiles:test`
- Add fail-fast CI integration command wrappers.
- Add docs and examples for extension authors.

#### 65) `@jskit-ai/config-eslint`

- Add lint rules preventing new static composition patches in app core.
- Add lint rules requiring descriptor files for new feature packages.
- Add lint rules for route/action/topic ID namespace conventions.

### 30.15 User packages

#### 66) `@jskit-ai/members-admin-client-element`

- Contribute members routes/nav fragments.
- Add capability dependency on workspace member management.
- Add profile tests for visibility by permissions.

#### 67) `@jskit-ai/profile-client-element`

- Contribute profile routes fragments.
- Add account settings nav fragments via module hook.
- Add mount path customization compatibility tests.

#### 68) `@jskit-ai/user-profile-core`

- Export profile/avatar service hook.
- Declare storage capability requirements.
- Add startup diagnostics for missing storage provider.

#### 69) `@jskit-ai/user-profile-knex-mysql`

- Export user profile repository + migrations hooks.
- Add migration tests and repository contract tests.
- Validate module dependency with user-profile-core.

### 30.16 Web packages

#### 70) `@jskit-ai/http-client-runtime`

- Export transport capability for composed client API fragments.
- Add tests for fragment merge and conflict behavior.
- Ensure CSRF token handling remains centralized and composable.

#### 71) `@jskit-ai/web-runtime-core`

- Keep core client runtime primitives.
- Add utilities for composed client bootstrap feature map.
- Add tests for safe defaults when optional modules disabled.

### 30.17 Workspace packages

#### 72) `@jskit-ai/console-errors-fastify-routes`

- Export console errors route/controller hooks.
- Add profile and permission metadata.
- Add docs generation fragment tests.

#### 73) `@jskit-ai/console-fastify-routes`

- Export console routes/controller hooks.
- Convert any path assumptions to mount keys.
- Add policy alignment tests for console surfaces.

#### 74) `@jskit-ai/settings-fastify-routes`

- Export settings routes/controller hooks.
- Add mount template support.
- Add tests for auth/workspace policy metadata consistency.

#### 75) `@jskit-ai/workspace-console-core`

- Keep contracts and models.
- Add capability declarations for console settings model.
- Add compatibility tests for schema evolution.

#### 76) `@jskit-ai/workspace-console-knex-mysql`

- Export console repositories/migrations hooks.
- Add migration ordering metadata.
- Add tests for module-off behavior.

#### 77) `@jskit-ai/workspace-console-service-core`

- Export service/action hooks.
- Integrate with composed alerts/realtime capabilities.
- Add strict profile tests ensuring required foundation behavior.

#### 78) `@jskit-ai/workspace-fastify-adapter`

- Export workspace route/controller hooks.
- Keep bootstrap contract ownership.
- Add compatibility support for composed `app.modules` feature map.

#### 79) `@jskit-ai/workspace-knex-mysql`

- Export workspace repositories/migrations hooks.
- Keep tenancy ownership semantics.
- Add tests ensuring workspace scoping invariants under composition.

#### 80) `@jskit-ai/workspace-service-core`

- Export workspace services and action hooks.
- Refactor fixed feature flags to composed module feature map.
- Add startup diagnostics for required profile modules.
- Add tests for bootstrap payload consistency with module toggles.

---

## 31) Expanded App-Local Refactor Checklist

The following concrete app files must be refactored in order.

### 31.1 Server side app files

1. `apps/jskit-value-app/server/runtime/repositories.js`
2. `apps/jskit-value-app/server/runtime/services.js`
3. `apps/jskit-value-app/server/runtime/controllers.js`
4. `apps/jskit-value-app/server/modules/api/routes.js`
5. `apps/jskit-value-app/server/runtime/actions/contributorManifest.js`
6. `apps/jskit-value-app/server.js`

For each file:

- Replace static imports with composed artifact reads.
- Preserve existing seam export shape during migration.
- Add parity test for produced artifacts.

### 31.2 Client side app files

1. `apps/jskit-value-app/src/platform/http/api/index.js`
2. `apps/jskit-value-app/src/app/router/factory.js`
3. `apps/jskit-value-app/src/app/router/app.js`
4. `apps/jskit-value-app/src/app/router/admin.js`
5. `apps/jskit-value-app/src/platform/realtime/realtimeEventHandlers.js`
6. `apps/jskit-value-app/src/app/shells/app/useAppShell.js`
7. `apps/jskit-value-app/src/app/shells/admin/useAdminShell.js`

For each file:

- Replace feature hardcoding with fragment composition output.
- Maintain current UX behavior while modules enabled.
- Add off-state tests for optional modules.

### 31.3 Shared policy files

1. `apps/jskit-value-app/shared/eventTypes.js`
2. `apps/jskit-value-app/shared/topicRegistry.js`
3. `apps/jskit-value-app/shared/actionIds.js`

Strategy:

- move toward generated or composed registries
- retain manual constants only where truly canonical
- add generator consistency tests if codegen introduced

---

## 32) Expanded Documentation Deliverables

Must create/update these docs during implementation:

1. `docs/architecture/module-framework.md`
2. `docs/architecture/module-descriptor-contract.md`
3. `docs/architecture/module-hooks-reference.md`
4. `docs/architecture/module-capabilities.md`
5. `docs/architecture/url-mount-customization.md`
6. `docs/architecture/profile-and-tier-policy.md`
7. `docs/operations/module-composition-runbook.md`
8. `docs/operations/module-incident-response.md`
9. `docs/operations/module-rollout-checklist.md`
10. `docs/operations/module-extension-security.md`

---

## 33) Expanded Definition of Done Checklists

### 33.1 Technical DoD

- [ ] Module framework package published and adopted by app.
- [ ] All 80 packages represented with descriptors or mapped module contracts.
- [ ] Static composition hotspots and migration compatibility wrappers are removed.
- [ ] URL mount overrides verified on server and client.
- [ ] Dependency and capability checks enforced.
- [ ] Profile required module checks enforced.
- [ ] Optional module off-state verified for social/chat/billing/ai.
- [ ] Third-party module validation CLI available.
- [ ] CI matrix includes profile and strict/permissive modes.

### 33.2 Operational DoD

- [ ] Startup diagnostics endpoint available in non-prod.
- [ ] Composition report command used in release checklist.
- [ ] On-call runbook updated for module startup failures.
- [ ] Rollback flag documented and tested.

### 33.3 Governance DoD

- [ ] Contribution policy requires descriptor for new modules.
- [ ] Lint rules block new hardcoded composition patches.
- [ ] Review checklist enforced in PR template.

---

## 34) Expanded Immediate Backlog (Actionable Issue Templates)

Use these issue templates for initial work:

### Template A: Add module descriptor to package

- Package:
- Module ID:
- Tier:
- Capabilities provided:
- Capabilities required:
- Hooks implemented:
- Tests added:
- Docs updated:

### Template B: Migrate static composition seam

- File:
- Static behavior replaced:
- Composed behavior source:
- Parity tests added:
- Rollback path:

### Template C: Add URL mount and override support

- Module mount key:
- Default path:
- Override path:
- Alias path:
- Collision test cases:
- Docs updates:

### Template D: Dependency/capability rule

- Module:
- Dependency/capability:
- Strict behavior:
- Permissive behavior:
- Diagnostics code:
- Tests:

---

## 35) Final Reinforcement

The migration is complete only when a module author can add, remove, or disable a feature module by editing module descriptors and registry/profile configuration, without patching app core composition files.

That remains the standard for this repository to credibly operate as a framework.
