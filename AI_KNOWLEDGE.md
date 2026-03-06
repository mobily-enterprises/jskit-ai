# AI Knowledge Base for JSKIT (Non-LEGACY)

This file is an AI-first operational map of the repository.
It is intentionally directive and implementation-aware.
It excludes `LEGACY/`.

## 1. Core Identity

- JSKIT is a Laravel-style Node.js framework built around **service providers**, **dependency injection**, and **descriptor-driven runtime composition**.
- Composition root is provider lifecycle:
  - `register(app)` for binding capabilities.
  - `boot(app)` for wiring runtime behavior (routes, middleware, hooks).
  - `shutdown(app)` for teardown.
- Important runtime pattern:
  - Shell bootstraps Fastify/Vue.
  - Installed package descriptors in `.jskit/lock.json` define what providers/modules are loaded.

Primary references:
- `/packages/kernel/server/kernel/lib/application.js`
- `/packages/kernel/server/container/lib/container.js`
- `/packages/kernel/server/platform/providerRuntime.js`
- `/docs/manual/001-Intro:_Create_An_App.md`
- `/docs/manual/002-Kernel:_Server:_App_And_Provider_Classes.md`
- `/docs/manual/003-Kernel:_Server:_Real applications.md`

## 2. Non-Negotiable AI Rules

- MUST keep provider IDs unique across loaded providers.
- MUST keep descriptor contracts valid (`runtime.server.providers[].entrypoint/export`, capability `provides/requires`).
- MUST keep transport schemas aligned with actual runtime response shapes (especially error responses).
- MUST use provider composition root for wiring (`app.make(...)` in providers), not service-locator style in controllers/actions.
- MUST use route contract normalization + `request.input` for transport shaping.
- MUST keep layer boundaries:
  - provider = composition
  - controller = HTTP adapter
  - action = use-case orchestration
  - service = reusable domain logic
  - repository = persistence boundary
- NEVER silently widen scope during fixes.
- NEVER add machine-specific absolute paths to published code.

## 3. Repo Structure (Important Only)

- Kernel/framework core:
  - `/packages/kernel`
- Runtime capability packages:
  - `/packages/access-core`
  - `/packages/action-runtime-core`
  - `/packages/auth-provider-supabase-core`
  - `/packages/auth-web`
  - `/packages/fastify-auth-policy`
  - `/packages/http-client-runtime`
  - `/packages/http-contracts`
  - `/packages/rbac-core`
- Tooling:
  - `/tooling/create-app`
  - `/tooling/jskit-cli`
  - `/tooling/jskit-catalog`
  - `/tooling/config-eslint`
- Manual examples:
  - `/docs/examples/*`
  - Chapter 3 staged server architecture: `/docs/examples/03.real-app`

## 4. Descriptor and Capability Model

- Package descriptor is the contract for installation + runtime loading.
- Capability closure is enforced at runtime and CLI mutation time.
- `requires` missing from installed/provided capabilities causes failure.

References:
- `/packages/*/package.descriptor.mjs`
- `/packages/kernel/server/platform/providerRuntime.js`
- `/tooling/jskit-cli/src/server/index.js`

## 5. Provider Lifecycle and Container Semantics

### 5.1 Provider Lifecycle

- `Application.start()`:
  - normalize providers
  - topologically order by `dependsOn`
  - run all `register`
  - run all `boot`
- `Application.shutdown()` runs reverse order.
- lifecycle failures are wrapped as provider lifecycle errors.

Reference:
- `/packages/kernel/server/kernel/lib/application.js`

### 5.2 Container

Valid token types:
- non-empty string
- symbol
- function

Binding lifetimes:
- `bind` = transient
- `singleton` = app lifetime
- `scoped` = one per scope
- `instance` = prebuilt value

Other semantics:
- `createScope(scopeId)` creates isolated resolution boundary.
- `tag` + `resolveTag` create contributor groups.
- cycle detection exists for dependency resolution.

Reference:
- `/packages/kernel/server/container/lib/container.js`

## 6. HTTP Runtime Contracts

## 6.1 Router and Registration

- `HttpRouter` stores normalized route definitions.
- `registerRoutes` registers on Fastify, attaches request scope, applies input transforms, executes middleware stack, then handler.
- route policy fields become `route.config` for middleware/policy plugins.

References:
- `/packages/kernel/server/http/lib/router.js`
- `/packages/kernel/server/http/lib/kernel.js`

### 6.2 Route Contract API (Current)

Use inline route contract keys:
- `meta`
- `body`
- `query`
- `params`
- `response`
- `advanced.fastifySchema`
- `advanced.jskitInput`

Important:
- Legacy `schema` / `input` wrapper usage is intentionally not the canonical contract path.
- Normalize at contract boundary and consume via `request.input`.

References:
- `/packages/kernel/server/http/lib/routeContract.js`
- `/packages/kernel/server/http/lib/routeContract.test.js`

## 6.3 Error Model

Hierarchy:
- `AppError`
- `DomainError`
- `DomainValidationError` (422 default)
- `ConflictError` (409 default)
- `NotFoundError` (404 default)

Global API error handler:
- request validation errors map to `400`
- typed app errors preserve status/message/details
- unknown 5xx map to safe payloads

References:
- `/packages/kernel/server/runtime/errors.js`
- `/packages/kernel/server/runtime/fastifyBootstrap.js`

## 6.4 Request Scope + Middleware

- request scope attached by default (`request.scope`, configurable)
- request tokens bound in scope:
  - Request
  - Reply
  - RequestId
  - RequestScope
- middleware supports named aliases and groups
- unknown names, group cycles, alias/group collisions are hard errors

References:
- `/packages/kernel/server/http/lib/kernel.js`
- `/packages/kernel/shared/support/tokens.js`

## 7. Surface Runtime and Client Bootstrap

- Surface runtime controls route visibility across `app/admin/console` style surfaces.
- API paths are treated specially in server-side surface gating.
- Client bootstrap requires descriptor UI route declarations to match runtime route registration behavior.
- Duplicate client provider IDs are disallowed.

References:
- `/packages/kernel/shared/surface/runtime.js`
- `/packages/kernel/server/platform/surfaceRuntime.js`
- `/packages/kernel/client/moduleBootstrap.js`
- `/packages/kernel/client/shellBootstrap.js`

## 8. Package Responsibilities (Non-Kernel)

- `access-core`: auth constraints/validators/OAuth utilities + auth access APIs.
  - `/packages/access-core/src/server/*`
- `action-runtime-core`: action registry/contracts/pipeline/policies/idempotency/audit.
  - `/packages/action-runtime-core/src/lib/*`
- `auth-provider-supabase-core`: supabase auth service + auth action contributor.
  - `/packages/auth-provider-supabase-core/src/server/*`
- `auth-web`: auth HTTP routes/controllers + client auth UI/runtime.
  - `/packages/auth-web/src/server/*`
  - `/packages/auth-web/src/client/*`
- `fastify-auth-policy`: policy + CSRF enforcement plugin using route config metadata.
  - `/packages/fastify-auth-policy/src/server/lib/*`
- `http-client-runtime`: HTTP client runtime + CSRF/session/retry/stream support.
  - `/packages/http-client-runtime/src/lib/*`
- `http-contracts`: shared TypeBox contracts and standard error schemas.
  - `/packages/http-contracts/src/lib/*`
- `rbac-core`: RBAC manifest/permission model and invariants.
  - `/packages/rbac-core/src/server/lib/rbac.js`

## 9. Tooling Model

### 9.1 `create-app`

- Template copier with placeholder replacement.
- Supports `--template`, `--target`, `--force`, `--interactive`, `--dry-run`.
- Writes starter app plus seeded `.jskit/lock.json`.

References:
- `/tooling/create-app/src/server/index.js`
- `/tooling/create-app/templates/base-shell`
- `/tooling/create-app/templates/stagex`

### 9.2 `jskit-cli`

- Manages install/update/remove/list/show/doctor.
- Applies descriptor mutations (dependencies/scripts/files/text).
- Maintains lock state for reversible managed changes.
- Capability closure enforcement is central.

Reference:
- `/tooling/jskit-cli/src/server/index.js`

Important caution:
- Current dry-run paths in add/update/remove still execute some file/text mutation steps before skipping lock/package write paths. Treat dry-run as not fully side-effect-free unless fixed.

### 9.3 `jskit-catalog`

- Builds package catalog metadata from descriptors.
- Deterministic ordering matters.

Reference:
- `/tooling/jskit-catalog/scripts/build-catalog.mjs`

## 10. Manual Chapter 1 to 3: High-Value Knowledge

## 10.1 Chapter 1 (Create App)

Critical points:
- `create-app` writes the app `package.json`; do not pre-run `npm init`.
- Server shell initializes Fastify + TypeBox compiler + provider runtime from lock.
- `@local/main` is the app-owned module and default extension point.
- `MainServiceProvider` is the first backend composition root for app code.

References:
- `/docs/manual/001-Intro:_Create_An_App.md`
- `/tooling/create-app/templates/base-shell/server.js`
- `/tooling/create-app/templates/base-shell/packages/main/src/server/providers/MainServiceProvider.js`

## 10.2 Chapter 2 (App + Provider)

Critical points:
- Understand and correctly choose binding semantics (`bind`, `singleton`, `scoped`, `instance`).
- Use `dependsOn` only for true lifecycle ordering requirements.
- Use `make` for required dependencies, `has` for optional dependencies.
- Use `tag/resolveTag` for extensible contributor patterns.
- Treat most framework errors as contract violation signals, not business logic errors.

References:
- `/docs/manual/002-Kernel:_Server:_App_And_Provider_Classes.md`
- `/docs/examples/02.kernel/src/server/providers/*`

## 10.3 Chapter 3 (Real Applications) - Most Important

Chapter 3 is the canonical backend layering tutorial.
Current active stages in codebase are 1 to 7.

### Stage progression and intended learning

1. Stage 1: monolith provider route handlers.
2. Stage 2: controller extraction.
3. Stage 3: service extraction.
4. Stage 4: repository contract extraction.
5. Stage 5: action/use-case extraction.
6. Stage 6: route contract normalization into `request.input`.
7. Stage 7: typed domain errors + success-only controller (`BaseController`).

References:
- `/docs/examples/03.real-app/stages/server/providers/ContactProviderStage1.js`
- `/docs/examples/03.real-app/stages/server/providers/ContactProviderStage7.js`
- `/docs/examples/03.real-app/stages/server/controllers/ContactControllerStage7.js`

### Production baseline to copy

Use Stage 7 architecture as baseline:
- provider wires dependencies
- controller is thin and success-path only
- actions throw typed domain errors
- service splits validation from qualification logic
- repository encapsulates persistence
- route contracts own schema + normalization + response contracts

Critical files:
- `/docs/examples/03.real-app/stages/server/providers/ContactProviderStage7.js`
- `/docs/examples/03.real-app/stages/server/controllers/ContactControllerStage7.js`
- `/docs/examples/03.real-app/stages/server/actions/*Stage7.js`
- `/docs/examples/03.real-app/stages/server/services/ContactQualificationServiceStage7.js`
- `/docs/examples/03.real-app/stages/server/repositories/InMemoryContactRepositoryStage7.js`
- `/docs/examples/03.real-app/stages/shared/schemas/contactSchemasStage7.js`

### Validation mental model (must preserve)

- Transport validation: request shape and simple constraints (`400`).
- Domain validation: business rule violations (`422`).
- Persistence validation/conflict: repository/database invariants (`409` common policy).

Reference:
- `/docs/manual/003-Kernel:_Server:_Real applications.md` (Three Validation Levels section)

### Chapter 3 critical gotchas

- Response schema must match thrown error payload shape. If actions throw object-`details` errors, contracts must declare object-compatible schema for those statuses.
- Keep staged tutorial files for learning; for production templates/features use non-staged names and clean routes.
- Keep `metadata.server.routes` aligned with registered routes.

References:
- `/docs/examples/03.real-app/stages/shared/schemas/contactSchemasStage7.js`
- `/docs/examples/03.real-app/package.descriptor.mjs`

## 11. Canonical Pattern for New Backend Feature

1. Create shared contract file in `src/shared/schemas/*`.
2. Create input normalization functions in `src/shared/input/*`.
3. Create repository interface + implementation.
4. Create domain service(s).
5. Create action classes per use case.
6. Create controller that only adapts HTTP to action calls.
7. Wire everything in `MainServiceProvider` during `register`.
8. Register routes in `boot` with route contracts.
9. Throw typed app/domain errors from actions.
10. Keep tests at route + action + service levels.

## 12. Anti-Patterns to Avoid

- Business logic in providers.
- Container/service-locator calls deep inside controller/action methods when constructor injection is possible.
- Repeating normalization in services when contracts already normalize input.
- Returning ad-hoc error envelopes not reflected in route `response` schema.
- Editing descriptor/runtime route metadata without updating actual route registrations.
- Changing auth-policy route config field names without corresponding runtime mapping updates.

## 13. AI Change Safety Checklist

Before change:
- Identify layer being modified (provider/controller/action/service/repository/contract/tooling).
- Confirm descriptor and capability impact.
- Confirm whether route response schema must change.

During change:
- Keep interfaces explicit.
- Keep runtime behavior deterministic.
- Avoid hidden fallbacks that mask configuration errors.

After change:
- Run focused tests for touched package/template.
- Run route-level smoke checks for HTTP behavior if server path changed.
- Re-check descriptor alignment and lock behavior for tooling changes.

## 14. High-Value Commands

Top-level:
- `npm run app:create -- <name>`
- `npm run jskit -- <command>`
- `npm run docs:sync`
- `npm run docs:verify`

Package-level tests:
- `npm --workspace packages/kernel test`
- `npm --workspace tooling/create-app test`
- `npm --workspace tooling/jskit-cli test`

Generated app checks:
- `npm install`
- `npm run server`
- route smoke via `fastify.inject` or `curl`

## 15. Current Template Guidance

- `base-shell`: minimal starter.
- `stagex`: full working contacts example using normal names and default `MainServiceProvider`.
  - routes:
    - `POST /api/v1/contacts/intake`
    - `POST /api/v1/contacts/preview-followup`
    - `GET /api/v1/contacts/:contactId`

References:
- `/tooling/create-app/templates/stagex/packages/main/src/server/providers/MainServiceProvider.js`
- `/tooling/create-app/templates/stagex/packages/main/src/shared/schemas/contactSchemas.js`

## 16. What AI Should Assume by Default

- Node 20 environment.
- Fastify + TypeBox transport contracts.
- Descriptor-driven package/runtime composition.
- Provider lifecycle is the authoritative startup model.
- Stage 7 architecture is the preferred server feature baseline for real app work.

