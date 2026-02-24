# `@jskit-ai/assistant-fastify-adapter`

## What This Package Is For

`@jskit-ai/assistant-fastify-adapter` is the Fastify transport layer for assistant APIs.

It owns:

1. Request/response schemas.
2. Route definitions.
3. HTTP controllers.
4. NDJSON stream writing helpers.
5. Uses shared HTTP schema primitives from `@jskit-ai/http-contracts` (enum + pagination query helpers).

It does not own assistant business rules.

## Why Apps Use It

In `apps/jskit-value-app`, wrappers inject app-specific permission checks and `AppError` behavior, while this package keeps stream transport behavior consistent.

## Public API

## `createSchema(options)` and `schema`

What they do:

- `createSchema(options)` builds TypeBox schema contracts for:
  - stream input body
  - list/messages query + params
  - stream/list/messages responses
- `schema` is a default instance using default limits.

Practical example:

- App can set `aiMaxInputChars` and `aiMaxHistoryMessages`, then route validation updates automatically.

## `buildRoutes(controllers, options)`

What it does:

- Returns route descriptors for assistant endpoints:
  1. `POST /api/workspace/ai/chat/stream`
  2. `GET /api/workspace/ai/conversations`
  3. `GET /api/workspace/ai/conversations/:conversationId/messages`

- Applies optional permission and error-response wrapping.

Practical example:

- App can enforce `workspace.ai.chat` permission only when AI is enabled.

Why apps use it:

- Keeps route contracts reusable and consistent.

## `createController({ aiService, aiTranscriptsService, appErrorClass, hasPermissionFn })`

What it does:

- Creates Fastify handlers for stream/list/get flows.
- Handles pre-stream vs in-stream error behavior correctly.

Returned handlers:

1. `chatStream(request, reply)`
   - Streams NDJSON assistant events.
   - Example: user sends prompt and receives token-by-token response.
2. `listConversations(request, reply)`
   - Lists conversations (user scope or admin workspace scope).
   - Example: history page in app/admin surfaces.
3. `getConversationMessages(request, reply)`
   - Returns one conversation's transcript messages.
   - Example: open an older assistant conversation.

Why apps use it:

- Keeps HTTP streaming/controller edge cases isolated from business logic.

## NDJSON Helpers

### `setNdjsonHeaders(reply)`

- Sets headers for NDJSON streaming.
- Example: before first stream event write.

### `writeNdjson(reply, payload)`

- Writes one JSON line if stream is writable.
- Example: send `assistant_delta` event.

### `endNdjson(reply)`

- Safely ends stream if still open.
- Example: after final `done` event.

### `safeStreamError(reply, payload)`

- Best-effort write error event, then close stream.
- Example: provider throws after stream started.

Why apps use NDJSON helpers:

- Prevents repeated low-level stream-safety code in controllers.

## `assistantControllerTestables`

What it does:

- Exposes internal error-mapping helpers for tests.

Practical example:

- Test pre-stream AppError maps to correct HTTP status and payload.

## How It Is Used In Real App Flow

1. App builds assistant core service.
2. App creates adapter controller with service dependencies.
3. App builds and registers routes.
4. On stream requests, adapter emits NDJSON events from core callbacks.

This package is the HTTP/stream boundary between Fastify and assistant core.
