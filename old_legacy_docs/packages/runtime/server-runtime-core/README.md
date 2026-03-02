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
- `@jskit-ai/server-runtime-core/lockfile`
  - `readLockFromApp`
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

## Non-goals

- Framework-specific Fastify plugins/controllers
- App/domain-specific validation and policy logic
- Database-specific primitives
