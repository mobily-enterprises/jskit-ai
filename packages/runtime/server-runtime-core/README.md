# @jskit-ai/server-runtime-core

Shared server-side runtime primitives for request/error/number normalization.

## Purpose

Centralize app-agnostic server runtime helpers used across services, adapters, and controllers.

## Public API

- `@jskit-ai/server-runtime-core/errors`
  - `AppError`
  - `isAppError`
- `@jskit-ai/server-runtime-core/integers`
  - `parsePositiveInteger`
- `@jskit-ai/server-runtime-core/requestUrl`
  - `safeRequestUrl`
  - `safePathnameFromRequest`
  - `resolveClientIpAddress`
- `@jskit-ai/server-runtime-core/pagination`
  - `normalizePagination`
- `@jskit-ai/server-runtime-core/realtimePublish`
  - `normalizeHeaderValue`
  - `resolvePublishMethod`
  - `buildPublishRequestMeta`
  - `warnPublishFailure`
  - `publishSafely`
- `@jskit-ai/server-runtime-core/realtimeEvents`
  - `createRealtimeEventsBus`
  - `createRealtimeEventEnvelope`
  - `createTargetedChatEventEnvelope`
  - `normalizePositiveIntegerOrNull`
  - `normalizeStringOrNull`
  - `normalizeEntityId`
  - `normalizePositiveIntegerArray`
  - `normalizeScopeKind`
  - `normalizeStringifiedPositiveIntegerOrNull`
- `@jskit-ai/server-runtime-core/realtimeEventsService`
  - `createService`
- `@jskit-ai/server-runtime-core/securityAudit`
  - `buildAuditEventBase`
  - `buildAuditError`
  - `recordAuditEvent`
  - `withAuditEvent`
- `@jskit-ai/server-runtime-core/composition`
  - `createRepositoryRegistry`
  - `createServiceRegistry`
  - `createControllerRegistry`
  - `selectRuntimeServices`
  - `createRuntimeComposition`
- `@jskit-ai/server-runtime-core/runtimeKernel`
  - `normalizeRuntimeBundle`
  - `createRuntimeKernel`
- `@jskit-ai/server-runtime-core/runtimeAssembly`
  - `mergeRuntimeBundles`
  - `createRuntimeAssembly`
  - `buildRoutesFromManifest`
- `@jskit-ai/server-runtime-core/serverContributions`
  - `normalizeServerContributions`
  - `mergeServerContributions`
  - `loadServerContributionsFromApp`
  - `loadServerContributionsFromLock`
  - `createServerRuntimeFromContributions`
  - `createServerRuntimeFromApp`
  - `createServerRuntimeFromLock`
  - `initializeContributedPlugins`
  - `initializeContributedWorkers`
  - `runLifecyclePhase`
  - `applyContributedRuntimeLifecycle`
- `@jskit-ai/server-runtime-core/apiRouteRegistration`
  - `registerApiRouteDefinitions`
- `@jskit-ai/server-runtime-core/fastifyBootstrap`
  - `resolveLoggerLevel`
  - `createFastifyLoggerOptions`
  - `registerRequestLoggingHooks`
  - `registerApiErrorHandler`
  - `resolveDatabaseErrorCode`
  - `recordDbErrorBestEffort`
  - `runGracefulShutdown`

## Examples

```js
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { createControllerRegistry } from "@jskit-ai/server-runtime-core/composition";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { createRealtimeEventsBus, createRealtimeEventEnvelope } from "@jskit-ai/server-runtime-core/realtimeEvents";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import { buildPublishRequestMeta, publishSafely } from "@jskit-ai/server-runtime-core/realtimePublish";
import { buildAuditEventBase } from "@jskit-ai/server-runtime-core/securityAudit";

const workspaceId = parsePositiveInteger(request.params.workspaceId);
if (!workspaceId) {
  throw new AppError(400, "Validation failed.");
}

const pathname = safePathnameFromRequest(request);
const auditBase = buildAuditEventBase(request);

publishSafely({
  publishMethod: realtimeEventsService?.publishWorkspaceEvent,
  payload: {
    eventType: "workspace.meta.updated",
    topic: "workspace_meta",
    ...buildPublishRequestMeta(request)
  },
  request,
  logCode: "workspace.realtime.publish_failed"
});

const realtimeEventsBus = createRealtimeEventsBus();
const envelope = createRealtimeEventEnvelope({
  eventType: "workspace.project.updated",
  topic: "projects",
  entityType: "project",
  entityId: 42
});
realtimeEventsBus.publish(envelope);

const controllers = createControllerRegistry({
  definitions: [
    {
      id: "health",
      create: ({ services }) => ({ get: () => services.healthService.ping() })
    }
  ],
  services: {
    healthService: {
      ping: () => "ok"
    }
  }
});
controllers.health.get();
```

Additional practical examples:

- `createRuntimeAssembly(...)`: merge multiple feature runtime bundles into one composition output during app boot.
- `buildRoutesFromManifest(...)`: derive route arrays from declarative module manifest.
- `registerApiRouteDefinitions(...)`: register route definitions on Fastify without duplicating per-route registration glue.
- `resolveDatabaseErrorCode(error)`: classify DB failure codes before recording observability metrics.

### Canonical Server Contribution Contract

Each package contribution entrypoint should return this shape:

```js
export function createServerContributions() {
  return {
    repositories: [{ id: "usersRepository", create: () => ({}) }],
    services: [{ id: "usersService", create: ({ repositories }) => ({}) }],
    controllers: [{ id: "users", create: ({ services }) => ({}) }],
    routes: [{ id: "users", buildRoutes: (controllers) => [] }],
    actions: [],
    plugins: [],
    workers: [],
    lifecycle: [{ id: "users.lifecycle", onBoot: async () => {}, onShutdown: async () => {} }]
  };
}
```

Validation rules:

- unknown top-level keys are rejected
- ids are required and unique per contribution category
- route definitions require `buildRoutes` (and optional `resolveOptions`)
- lifecycle definitions require `onBoot` and/or `onShutdown`

## Non-goals

- Framework-specific Fastify plugins/controllers
- App/domain-specific validation and policy logic
- Database-specific primitives
