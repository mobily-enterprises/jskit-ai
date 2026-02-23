# `@jskit-ai/chat-fastify-adapter`

## What This Package Is For

`@jskit-ai/chat-fastify-adapter` connects chat core services to Fastify HTTP routes.

It owns transport concerns:

1. Route definitions.
2. Request/response schemas.
3. Controller request parsing (including multipart upload parsing).

It does not own chat business rules.

## Why Apps Use It

In `apps/jskit-value-app`, wrappers import this package and inject app specifics like:

1. `AppError` class.
2. standard error-response wrapper.

This lets the app keep HTTP contracts stable while sharing route/controller logic across apps.

## Public API

## `createSchema(options)`

What it does:

- Builds TypeBox schemas for chat request/response contracts.
- Supports limits such as message max chars and attachment max bytes.

Real-life example:

- An app with smaller upload policy can set lower `attachmentMaxUploadBytes`.

Why apps use it:

- Keeps OpenAPI docs, validation, and runtime expectations aligned.

## `buildRoutes(controllers, options)`

What it does:

- Returns Fastify-style route objects for chat endpoints.
- Wires schemas, auth metadata, rate-limit metadata, handler names.

Practical route examples it defines:

1. `POST /api/chat/workspace/ensure`
2. `POST /api/chat/dm/ensure`
3. `GET /api/chat/inbox`
4. `GET /api/chat/threads/:threadId/messages`
5. `POST /api/chat/threads/:threadId/messages`
6. attachment reserve/upload/delete/content routes
7. read cursor + reaction + typing routes

Why apps use it:

- Prevents each app from rewriting the same route contracts.

## `createController({ chatService, appErrorClass })`

What it does:

- Creates HTTP handlers that translate Fastify requests into chat service calls.
- Handles multipart upload parsing for attachment upload endpoint.

Returned controller handlers and practical examples:

1. `ensureWorkspaceRoom`
   - Example: called when UI opens workspace chat tab.
2. `ensureDm`
   - Example: called when user starts DM by public chat ID.
3. `listDmCandidates`
   - Example: DM recipient search.
4. `listInbox`
   - Example: fetch inbox sidebar.
5. `getThread`
   - Example: open thread detail.
6. `listThreadMessages`
   - Example: message pagination.
7. `sendThreadMessage`
   - Example: send composer content.
8. `reserveThreadAttachment`
   - Example: reserve upload slot.
9. `uploadThreadAttachment`
   - Example: parse multipart file and upload.
10. `deleteThreadAttachment`
    - Example: remove staged attachment.
11. `getAttachmentContent`
    - Example: protected file download.
12. `markThreadRead`
    - Example: update unread state.
13. `addReaction`
    - Example: add emoji reaction.
14. `removeReaction`
    - Example: remove emoji reaction.
15. `emitThreadTyping`
    - Example: typing indicator heartbeat.

Why apps use it:

- Keeps controller code thin and deterministic; business rules remain in `@jskit-ai/chat-core`.

## `chatControllerTestables`

What it does:

- Test-only helpers for validation errors and multipart parsing behavior.

Real-life example:

- Unit test ensures oversize upload returns a field validation error.

## How It Is Used In Real App Flow

1. App creates chat core service.
2. App creates adapter controller with that service.
3. App builds routes with controller and registers routes in Fastify.
4. Requests hit adapter first, then core service.

This package is the HTTP boundary layer for shared chat behavior.
