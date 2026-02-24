# RAILS.md

Purpose: this file is the operating contract for LLM sessions working in this repository. If a change conflicts with this document, treat this document as the default project rail unless the user explicitly overrides it.

## 1) Canonical docs and scope

1. Canonical app docs live in `apps/jskit-value-app/docs`.
2. Root `docs/` is not canonical for this app and may be deleted; do not anchor new behavior contracts there.
3. Start every substantial task by reading:
- `README.md`
- `apps/jskit-value-app/README.md`
- `apps/jskit-value-app/docs/README.md`
4. Read the relevant domain doc(s) before changing behavior:
- `apps/jskit-value-app/docs/architecture/client-boundaries.md`
- `apps/jskit-value-app/docs/architecture/workspace-and-surfaces.md`
- `apps/jskit-value-app/docs/billing/contracts.md`
- `apps/jskit-value-app/docs/billing/integration.md`
- `apps/jskit-value-app/docs/billing/provider-insulation.md`
- `apps/jskit-value-app/docs/database/schema-areas.md`
- `apps/jskit-value-app/docs/database/billing-live-schema.md`
- `apps/jskit-value-app/docs/database/migrations-and-seeds.md`
- `apps/jskit-value-app/docs/operations/release-checklist.md`
- `apps/jskit-value-app/docs/operations/observability.md`
- `apps/jskit-value-app/docs/operations/retention-worker.md`

## 2) Architecture truths (do not violate)

1. Surfaces are `app`, `admin`, `console`.
2. `app` and `admin` are workspace-bound; `console` is global (no workspace required).
3. API paths are versioned through `shared/apiPaths.js` and normalized to `/api/v1/*`.
4. Server runtime is assembled via `@jskit-ai/platform-server-runtime` using:
- `server/runtime/platformModuleManifest.js`
- `server/runtime/repositories.js`
- `server/runtime/services.js`
- `server/runtime/controllers.js`
- `server/runtime/appFeatureManifest.js`
5. Route registration uses `server/modules/api/routes.js` and `server/fastify/registerApiRoutes.js`; route metadata drives auth/workspace policy.
6. Auth/workspace enforcement is via `@jskit-ai/fastify-auth-policy` in `server/fastify/auth.plugin.js`.
7. Client bootstraps from `src/app/bootstrap/runtime.js` and initializes auth/workspace/console state from `/api/v1/bootstrap`.
8. Realtime mechanics are package-owned; app owns policy in:
- `shared/topicRegistry.js`
- `server/fastify/realtime/subscribeContext.js`
- `server/realtime/registerSocketIoRealtime.js`

## 3) Module seam contract (server)

1. Each server module public seam is `server/modules/<module>/index.js`.
2. Allowed seam exports are only the contract exports used by the module (`createController`, `buildRoutes`, `schema`, `createService`, `createRepository`) with exact, intentional keys.
3. No default exports for module seams.
4. No wildcard seam exports.
5. `createService()` returns keyed objects (for example `{ service }`, `{ aiService, aiTranscriptsService }`).
6. `createRepository()` returns keyed objects (for example `{ repository }`, `{ threadsRepository, messagesRepository, ... }`).
7. Runtime composition outside a module should depend on module seam exports, not module internals.

## 4) Client boundaries

1. Package code is headless unless it is an approved client-element package.
2. Vue SFC in `packages/**` is limited to client-element packages.
3. Packages must not import style assets or visual frameworks.
4. Packages must not call rendering-entry APIs (`createApp`, `defineComponent`).
5. App code must not import package internals (`@jskit-ai/*/src`, `lib`, `test`, or relative deep paths into `packages`).
6. App thin pass-through wrappers are disallowed.
7. Runtime composition pattern is factory-based (`createAssistantRuntime`, `createChatRuntime`); avoid mutable global configure patterns.

## 5) Surface + policy rails

1. Always keep client guards and server route policy aligned.
2. Server routes requiring workspace must declare `workspacePolicy` and intended `workspaceSurface`.
3. Sensitive admin operations must require explicit permissions.
4. Console permissions are checked with `consoleStore.can(...)` on client and policy metadata/server checks on API routes.
5. Do not merge admin and app authorization semantics.

## 6) Billing rails

1. Billing contract behavior is fixed by docs in `apps/jskit-value-app/docs/billing/*` and existing tests.
2. Feature usage consumption is server-side only.
3. When billing state is uncertain, fail closed.
4. Provider-specific SDK logic stays in provider packages (`billing-provider-stripe`, `billing-provider-paddle`).
5. Core billing services must remain provider-agnostic and consume normalized provider outcomes.

## 7) Realtime rails

1. Topic permissions/surface access are defined in `shared/topicRegistry.js`.
2. Subscribe context must normalize/force `x-surface-id` and `x-workspace-slug` from connection context.
3. Unsupported surfaces/topics must be rejected explicitly.
4. Keep topic-level permission checks consistent between client eligibility and server enforcement.

## 8) Data + migration rails

1. Workspace-owned data stays scoped by `workspace_id`.
2. Migration execution is explicit (not app-boot implicit).
3. If schema behavior changes, update:
- migrations
- tests
- relevant docs in `apps/jskit-value-app/docs/database/*`
4. Billing schema semantics in `billing-live-schema.md` are operational references; do not drift behavior silently.

## 9) Error handling + validation rails

1. Use `AppError` for structured API failures.
2. Preserve field-level validation error shape (`fieldErrors`) for client forms.
3. Keep TypeBox/schema contracts and route metadata synchronized.
4. Do not leak provider/internal raw errors directly to API consumers.

## 10) Worker rails

1. Worker runtime is separate from web runtime lifecycle.
2. Retention queue topology and lock semantics must remain consistent with `docs/operations/retention-worker.md`.
3. CLI enqueue behavior (`idempotency-key`, `trigger`, dry-run) is contract behavior.

## 11) Testing + quality rails

1. Prefer targeted tests first, then broader suites.
2. Required architecture guardrails for boundary-sensitive changes:
- `npm run lint:architecture:client`
- `npm run test:architecture:client`
- `npm run test:architecture:shared-ui`
3. If API routes/route manifest change, run:
- `npm run -w apps/jskit-value-app docs:api-contracts:check`
4. For app behavior changes, run appropriate app checks:
- `npm run -w apps/jskit-value-app lint`
- `npm run -w apps/jskit-value-app test`
- `npm run -w apps/jskit-value-app test:client`

## 12) Documentation rails

1. Keep docs concise, non-overlapping, and task-oriented.
2. Do not create duplicate docs for the same contract.
3. Update the exact canonical doc when behavior changes.
4. Avoid speculative docs for unimplemented behavior unless explicitly marked as future work.

## 13) Session execution rails

1. Before coding: identify affected surface(s), module seam(s), policy boundaries, and required tests.
2. During coding: preserve seam contracts and avoid cross-boundary leakage.
3. After coding: run checks, fix regressions, and document contract-impacting changes.
4. Never silently change auth/workspace/billing/realtime contracts.

## 14) Package README index (must stay complete)

The following links must include every package README in this monorepo.
- [packages/ai-agent/assistant-client-element/README.md](./packages/ai-agent/assistant-client-element/README.md)
- [packages/ai-agent/assistant-client-runtime/README.md](./packages/ai-agent/assistant-client-runtime/README.md)
- [packages/ai-agent/assistant-contracts/README.md](./packages/ai-agent/assistant-contracts/README.md)
- [packages/ai-agent/assistant-core/README.md](./packages/ai-agent/assistant-core/README.md)
- [packages/ai-agent/assistant-fastify-adapter/README.md](./packages/ai-agent/assistant-fastify-adapter/README.md)
- [packages/ai-agent/assistant-provider-openai/README.md](./packages/ai-agent/assistant-provider-openai/README.md)
- [packages/ai-agent/assistant-transcript-explorer-client-element/README.md](./packages/ai-agent/assistant-transcript-explorer-client-element/README.md)
- [packages/ai-agent/assistant-transcripts-core/README.md](./packages/ai-agent/assistant-transcripts-core/README.md)
- [packages/ai-agent/assistant-transcripts-knex-mysql/README.md](./packages/ai-agent/assistant-transcripts-knex-mysql/README.md)
- [packages/auth/access-core/README.md](./packages/auth/access-core/README.md)
- [packages/auth/auth-fastify-adapter/README.md](./packages/auth/auth-fastify-adapter/README.md)
- [packages/auth/auth-provider-supabase-core/README.md](./packages/auth/auth-provider-supabase-core/README.md)
- [packages/auth/fastify-auth-policy/README.md](./packages/auth/fastify-auth-policy/README.md)
- [packages/auth/rbac-core/README.md](./packages/auth/rbac-core/README.md)
- [packages/billing/billing-commerce-client-element/README.md](./packages/billing/billing-commerce-client-element/README.md)
- [packages/billing/billing-console-admin-client-element/README.md](./packages/billing/billing-console-admin-client-element/README.md)
- [packages/billing/billing-core/README.md](./packages/billing/billing-core/README.md)
- [packages/billing/billing-fastify-adapter/README.md](./packages/billing/billing-fastify-adapter/README.md)
- [packages/billing/billing-knex-mysql/README.md](./packages/billing/billing-knex-mysql/README.md)
- [packages/billing/billing-plan-client-element/README.md](./packages/billing/billing-plan-client-element/README.md)
- [packages/billing/billing-provider-core/README.md](./packages/billing/billing-provider-core/README.md)
- [packages/billing/billing-provider-paddle/README.md](./packages/billing/billing-provider-paddle/README.md)
- [packages/billing/billing-provider-stripe/README.md](./packages/billing/billing-provider-stripe/README.md)
- [packages/billing/billing-service-core/README.md](./packages/billing/billing-service-core/README.md)
- [packages/billing/billing-worker-core/README.md](./packages/billing/billing-worker-core/README.md)
- [packages/billing/entitlements-core/README.md](./packages/billing/entitlements-core/README.md)
- [packages/billing/entitlements-knex-mysql/README.md](./packages/billing/entitlements-knex-mysql/README.md)
- [packages/chat/chat-client-element/README.md](./packages/chat/chat-client-element/README.md)
- [packages/chat/chat-client-runtime/README.md](./packages/chat/chat-client-runtime/README.md)
- [packages/chat/chat-contracts/README.md](./packages/chat/chat-contracts/README.md)
- [packages/chat/chat-core/README.md](./packages/chat/chat-core/README.md)
- [packages/chat/chat-fastify-adapter/README.md](./packages/chat/chat-fastify-adapter/README.md)
- [packages/chat/chat-knex-mysql/README.md](./packages/chat/chat-knex-mysql/README.md)
- [packages/chat/chat-storage-core/README.md](./packages/chat/chat-storage-core/README.md)
- [packages/communications/communications-contracts/README.md](./packages/communications/communications-contracts/README.md)
- [packages/communications/communications-core/README.md](./packages/communications/communications-core/README.md)
- [packages/communications/communications-fastify-adapter/README.md](./packages/communications/communications-fastify-adapter/README.md)
- [packages/communications/communications-provider-core/README.md](./packages/communications/communications-provider-core/README.md)
- [packages/communications/email-core/README.md](./packages/communications/email-core/README.md)
- [packages/communications/sms-core/README.md](./packages/communications/sms-core/README.md)
- [packages/contracts/http-contracts/README.md](./packages/contracts/http-contracts/README.md)
- [packages/contracts/realtime-contracts/README.md](./packages/contracts/realtime-contracts/README.md)
- [packages/observability/console-errors-client-element/README.md](./packages/observability/console-errors-client-element/README.md)
- [packages/observability/observability-core/README.md](./packages/observability/observability-core/README.md)
- [packages/observability/observability-fastify-adapter/README.md](./packages/observability/observability-fastify-adapter/README.md)
- [packages/operations/redis-ops-core/README.md](./packages/operations/redis-ops-core/README.md)
- [packages/operations/retention-core/README.md](./packages/operations/retention-core/README.md)
- [packages/realtime/realtime-client-runtime/README.md](./packages/realtime/realtime-client-runtime/README.md)
- [packages/realtime/realtime-server-socketio/README.md](./packages/realtime/realtime-server-socketio/README.md)
- [packages/runtime/health-fastify-adapter/README.md](./packages/runtime/health-fastify-adapter/README.md)
- [packages/runtime/knex-mysql-core/README.md](./packages/runtime/knex-mysql-core/README.md)
- [packages/runtime/platform-server-runtime/README.md](./packages/runtime/platform-server-runtime/README.md)
- [packages/runtime/runtime-env-core/README.md](./packages/runtime/runtime-env-core/README.md)
- [packages/runtime/server-runtime-core/README.md](./packages/runtime/server-runtime-core/README.md)
- [packages/security/security-audit-core/README.md](./packages/security/security-audit-core/README.md)
- [packages/security/security-audit-knex-mysql/README.md](./packages/security/security-audit-knex-mysql/README.md)
- [packages/surface-routing/README.md](./packages/surface-routing/README.md)
- [packages/tooling/app-scripts/README.md](./packages/tooling/app-scripts/README.md)
- [packages/tooling/config-eslint/README.md](./packages/tooling/config-eslint/README.md)
- [packages/users/members-admin-client-element/README.md](./packages/users/members-admin-client-element/README.md)
- [packages/users/profile-client-element/README.md](./packages/users/profile-client-element/README.md)
- [packages/users/user-profile-core/README.md](./packages/users/user-profile-core/README.md)
- [packages/users/user-profile-knex-mysql/README.md](./packages/users/user-profile-knex-mysql/README.md)
- [packages/web/http-client-runtime/README.md](./packages/web/http-client-runtime/README.md)
- [packages/web/web-runtime-core/README.md](./packages/web/web-runtime-core/README.md)
- [packages/workspace/console-errors-fastify-adapter/README.md](./packages/workspace/console-errors-fastify-adapter/README.md)
- [packages/workspace/console-fastify-adapter/README.md](./packages/workspace/console-fastify-adapter/README.md)
- [packages/workspace/settings-fastify-adapter/README.md](./packages/workspace/settings-fastify-adapter/README.md)
- [packages/workspace/workspace-console-core/README.md](./packages/workspace/workspace-console-core/README.md)
- [packages/workspace/workspace-console-knex-mysql/README.md](./packages/workspace/workspace-console-knex-mysql/README.md)
- [packages/workspace/workspace-console-service-core/README.md](./packages/workspace/workspace-console-service-core/README.md)
- [packages/workspace/workspace-fastify-adapter/README.md](./packages/workspace/workspace-fastify-adapter/README.md)
- [packages/workspace/workspace-knex-mysql/README.md](./packages/workspace/workspace-knex-mysql/README.md)
- [packages/workspace/workspace-service-core/README.md](./packages/workspace/workspace-service-core/README.md)

## 15) Non-negotiable anti-patterns

1. Do not import package internals from app code.
2. Do not add package UI framework coupling outside approved client-element packages.
3. Do not bypass route policy metadata with ad-hoc auth logic.
4. Do not add provider-specific billing literals into billing core services.
5. Do not introduce global mutable runtime config patterns where factories already exist.
