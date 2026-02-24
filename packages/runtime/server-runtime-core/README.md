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

## Examples

```js
import { AppError } from "@jskit-ai/server-runtime-core/errors";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { createRealtimeEventsBus, createRealtimeEventEnvelope } from "@jskit-ai/server-runtime-core/realtimeEvents";
import { safePathnameFromRequest } from "@jskit-ai/server-runtime-core/requestUrl";
import { buildPublishRequestMeta, publishSafely } from "@jskit-ai/server-runtime-core/realtimePublish";

const workspaceId = parsePositiveInteger(request.params.workspaceId);
if (!workspaceId) {
  throw new AppError(400, "Validation failed.");
}

const pathname = safePathnameFromRequest(request);

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
```

## Non-goals

- Framework-specific Fastify plugins/controllers
- App/domain-specific validation and policy logic
- Database-specific primitives
