# `@jskit-ai/realtime-server-socketio`

Reusable Socket.IO server runtime for SaaS realtime backends.

Plain-language summary:
This package is the shared server "engine" for realtime websockets. It handles Socket.IO lifecycle, protocol message handling, room fanout, Redis adapter wiring, and shutdown cleanup. Your app still owns business policy: topic vocabulary, permission checks, workspace rules, and auth strategy.

---

## Table Of Contents

1. [What This Package Is For](#1-what-this-package-is-for)
2. [What This Package Is Not For](#2-what-this-package-is-not-for)
3. [How It Relates To Other Realtime Packages](#3-how-it-relates-to-other-realtime-packages)
4. [Beginner Glossary](#4-beginner-glossary)
5. [Quick Runtime Flow](#5-quick-runtime-flow)
6. [Install](#6-install)
7. [Public Exports](#7-public-exports)
8. [Main API: `registerRealtimeServerSocketio`](#8-main-api-registerrealtimeserversocketio)
9. [Required App Functions (Every Function + Real Examples)](#9-required-app-functions-every-function--real-examples)
10. [Optional Hooks (Every Optional Function + Real Examples)](#10-optional-hooks-every-optional-function--real-examples)
11. [Exported Test Helpers (`__testables`) (Every Function + Real Examples)](#11-exported-test-helpers-__testables-every-function--real-examples)
12. [Protocol Message Shapes (Client/Server)](#12-protocol-message-shapes-clientserver)
13. [How Apps Use This Package In Real Terms (And Why)](#13-how-apps-use-this-package-in-real-terms-and-why)
14. [Complete App Integration Example](#14-complete-app-integration-example)
15. [Troubleshooting](#15-troubleshooting)
16. [Common Mistakes](#16-common-mistakes)

---

## 1) What This Package Is For

Use this package when you want one shared, reliable realtime server runtime across many apps.

It provides reusable mechanics for:

1. Websocket connection middleware with auth orchestration.
2. Protocol handling for `subscribe`, `unsubscribe`, and `ping`.
3. Socket room membership for workspace/topic and user targeting.
4. Event fanout from your app's event stream.
5. Optional Redis Streams adapter setup for multi-instance fanout.
6. Graceful shutdown of Socket.IO + Redis.

Practical value for a multi-app monorepo:

1. You avoid rewriting Socket.IO wiring in each app.
2. Behavior is consistent across apps (same protocol and error behavior).
3. Fixes to runtime mechanics are made once and reused everywhere.

---

## 2) What This Package Is Not For

This package intentionally does not define:

1. Your topic names (`"projects"`, `"chat"`, etc.).
2. Your permission strings (`"projects.read"`, etc.).
3. Your surface vocabulary (`"app"`, `"admin"`, etc.).
4. Your workspace/business policy.
5. Your domain events producer.

Why this boundary matters:

1. Shared package stays app-agnostic and reusable.
2. App policy remains explicit and local.
3. You avoid hidden coupling between apps.

---

## 3) How It Relates To Other Realtime Packages

There are usually three layers:

1. `@jskit-ai/realtime-contracts`:
Shared protocol constants and topic-catalog mechanics.

2. `@jskit-ai/realtime-client-runtime`:
Client-side runtime (connect/reconnect/subscribe tracking).

3. `@jskit-ai/realtime-server-socketio` (this package):
Server-side Socket.IO runtime and fanout mechanics.

Do they call each other directly?

1. This package directly uses `@jskit-ai/realtime-contracts` constants (`REALTIME_MESSAGE_TYPES`, `REALTIME_ERROR_CODES`).
2. This package does not import or call `@jskit-ai/realtime-client-runtime`.
3. Client and server runtimes communicate through protocol messages over websocket; they are decoupled packages.

Why two runtimes (client/server)?

1. Frontend concerns (reconnect/replay/deferred self-events) are different from backend concerns (auth/fanout/rooms/Redis adapter).
2. Splitting keeps each package focused and easier to test.
3. Apps can reuse server runtime without forcing any specific frontend framework.

---

## 4) Beginner Glossary

1. **Socket**: one active websocket connection from one browser/client.
2. **Topic**: a logical stream/channel (example: `projects`).
3. **Surface**: app context (`app`, `admin`, `console`) used by policy.
4. **Subscribe**: client asks to receive events for topics.
5. **Room**: Socket.IO grouping key used for fanout.
6. **Fanout**: send one event to many sockets.
7. **Targeted fanout**: send event to specific users (`targetUserIds`).
8. **Handshake**: initial connection phase before normal messages.
9. **Workspace slug**: human-friendly workspace key (example: `acme`).

---

## 5) Quick Runtime Flow

Connection phase:

1. Runtime reads `surface` from handshake query.
2. Runtime validates/normalizes surface using `normalizeConnectionSurface`.
3. Runtime builds a request context from handshake headers/query/cookies.
4. Runtime calls `authService.authenticateRequest(requestContext)`.
5. If authenticated, runtime stores user + context on `socket.data`.
6. Runtime joins user room `u:{userId}` for targeted fanout.

Message phase:

1. Runtime reads inbound messages on `realtime:message`.
2. It validates payload size and shape.
3. For `subscribe`, it validates topic/surface/workspace + permissions.
4. It joins workspace/topic room `w:{workspaceId}:t:{topic}`.
5. For `unsubscribe`, it removes matching room memberships.
6. For `ping`, it sends `pong`.

Fanout phase:

1. Runtime listens to `realtimeEventsService.subscribe(listener)`.
2. If event has `targetUserIds`, emits to user rooms.
3. Otherwise emits by workspace/topic room.
4. Before delivery, runtime re-checks authorization per socket.
5. If a socket is no longer allowed, runtime evicts that subscription.

Shutdown phase:

1. Runtime unsubscribes from event stream.
2. Runtime closes Socket.IO server.
3. Runtime closes Redis client safely with timeout fallback.

---

## 6) Install

In app workspace `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/realtime-server-socketio": "0.1.0"
  }
}
```

Install from monorepo root:

```bash
npm install
```

---

## 7) Public Exports

```js
import {
  registerRealtimeServerSocketio,
  SOCKET_IO_PATH,
  SOCKET_IO_MESSAGE_EVENT,
  MAX_INBOUND_MESSAGE_BYTES,
  __testables
} from "@jskit-ai/realtime-server-socketio";
```

Export purpose summary:

1. `registerRealtimeServerSocketio`: main runtime entrypoint.
2. `SOCKET_IO_PATH`: default websocket path (`/api/realtime`).
3. `SOCKET_IO_MESSAGE_EVENT`: protocol event name (`realtime:message`).
4. `MAX_INBOUND_MESSAGE_BYTES`: default inbound message cap (`8192`).
5. `__testables`: low-level helpers for deterministic tests.

---

## 8) Main API: `registerRealtimeServerSocketio`

### Signature

```js
await registerRealtimeServerSocketio(fastify, options)
```

Returns:

1. A Socket.IO server instance.

What this function does in real terms:

1. Creates Socket.IO server on Fastify's HTTP server.
2. Optionally connects Redis and attaches Redis Streams adapter.
3. Registers auth middleware for incoming websocket connections.
4. Registers protocol handlers for subscribe/unsubscribe/ping.
5. Subscribes to your event stream for fanout.
6. Adds Fastify `onClose` hook for cleanup.

Real-life example:

1. Your billing app and project-management app both call this during bootstrap.
2. Both get identical, battle-tested server mechanics.
3. Each app injects its own policy callbacks and topic registry.

### `fastify` argument

Required behavior:

1. Must expose `fastify.server` (HTTP server).
2. Must support `fastify.addHook("onClose", async () => {})`.

Practical example:

```js
const io = await registerRealtimeServerSocketio(fastify, options);
```

### Required `options` keys

1. `authService` object with `authenticateRequest(requestContext)`.
2. `realtimeEventsService` object with `subscribe(listener)`.
3. `workspaceService` object with `resolveRequestContext(input)`.
4. `isSupportedTopic(topic)`.
5. `isTopicAllowedForSurface(topic, surfaceId)`.
6. `hasTopicPermission(topic, permissions, surfaceId)`.
7. `buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId)`.
8. `normalizeConnectionSurface(value)`.
9. `normalizeWorkspaceSlug(value)`.

### Optional `options` keys

1. `redisUrl` (default `""`).
2. `requireRedisAdapter` (default `false`).
3. `logger` with `info(payload, message)` and/or `warn(payload, message)`.
4. `path` (default `SOCKET_IO_PATH`).
5. `maxInboundMessageBytes` (default `MAX_INBOUND_MESSAGE_BYTES`).
6. `redisQuitTimeoutMs` (default `5000`, max `60000`).
7. `redisConnectTimeoutMs` (default `5000`, max `60000`).
8. `redisClientFactory` (advanced/testing override).
9. `redisStreamsAdapterFactory` (advanced/testing override).

### Common runtime outcomes

1. If `requireRedisAdapter` is `true` and Redis connection fails, startup throws.
2. If `requireRedisAdapter` is `false` and Redis fails, runtime continues with in-memory adapter.
3. Oversized inbound payload causes `payload_too_large` protocol error and disconnect.

---

## 9) Required App Functions (Every Function + Real Examples)

This section documents every required function your app must provide to the runtime.

### `authService.authenticateRequest(requestContext)`

What it does:

1. Authenticates socket handshake request.
2. Returns auth status and user profile for socket identity.

Expected return shape (success):

```js
{
  authenticated: true,
  profile: {
    id: 7,
    email: "user@example.com",
    displayName: "Jane"
  },
  transientFailure: false
}
```

Practical real-life example:

1. Read session cookie from `requestContext.headers.cookie`.
2. Verify session token against your auth backend.
3. Return `authenticated: true` with user profile.

Why apps need this:

1. Server runtime cannot know your auth system.

### `realtimeEventsService.subscribe(listener)`

What it does:

1. Connects runtime to your domain event stream.
2. Invokes `listener(eventEnvelope)` whenever realtime event should be emitted.
3. Returns an `unsubscribe` function used at shutdown.

Practical real-life example:

1. Your domain services publish event envelopes into an in-process pub/sub bus.
2. `subscribe(listener)` attaches runtime to that bus.
3. Returned `unsubscribe()` removes listener when server stops.

Minimal example:

```js
function subscribe(listener) {
  eventBus.on("realtime", listener);
  return () => eventBus.off("realtime", listener);
}
```

Why apps need this:

1. Runtime handles delivery mechanics, app still decides which events exist.

### `workspaceService.resolveRequestContext(input)`

What it does:

1. Resolves workspace and permission context for a user + workspace request.
2. Used during subscribe authorization and fanout re-authorization.

Input shape runtime provides:

```js
{
  user,
  request,
  workspacePolicy: "required",
  workspaceSurface: "app"
}
```

Expected minimal success shape:

```js
{
  workspace: { id: 11, slug: "acme" },
  permissions: ["projects.read"]
}
```

Practical real-life example:

1. Workspace slug is read from request headers (set by `buildSubscribeContextRequest`).
2. Service checks if user is member of that workspace.
3. Returns workspace info and role-based permissions.

Why apps need this:

1. Shared runtime does not know your membership schema.

### `isSupportedTopic(topic)`

What it does:

1. Validates that a topic exists in app topic vocabulary.

Practical real-life example:

```js
const SUPPORTED_TOPICS = new Set(["projects", "workspace_meta", "chat"]);

function isSupportedTopic(topic) {
  return SUPPORTED_TOPICS.has(String(topic || "").trim());
}
```

Why apps need this:

1. Prevents unknown/typo topic subscriptions.

### `isTopicAllowedForSurface(topic, surfaceId)`

What it does:

1. Enforces which topics are visible on which surface.

Practical real-life example:

```js
function isTopicAllowedForSurface(topic, surfaceId) {
  if (topic === "workspace_settings") {
    return surfaceId === "admin";
  }

  if (topic === "projects") {
    return surfaceId === "app" || surfaceId === "admin";
  }

  return false;
}
```

Why apps need this:

1. Prevents leaking admin-only streams to regular app surfaces.

### `hasTopicPermission(topic, permissions, surfaceId)`

What it does:

1. Authorizes topic access based on permission list.
2. Called at subscribe time and fanout delivery time.

Practical real-life example:

```js
function hasTopicPermission(topic, permissions, surfaceId) {
  const set = new Set(Array.isArray(permissions) ? permissions : []);

  if (topic === "workspace_meta") {
    return true;
  }

  if (topic === "projects") {
    return set.has("projects.read") || set.has("*");
  }

  if (topic === "workspace_settings" && surfaceId === "admin") {
    return set.has("workspace.settings.view") || set.has("workspace.settings.update");
  }

  return false;
}
```

Why apps need this:

1. Runtime does not own your permission vocabulary.

### `buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId)`

What it does:

1. Builds request object used by `workspaceService.resolveRequestContext`.
2. Usually adds workspace/surface headers or metadata.

Practical real-life example:

```js
function buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId) {
  return {
    ...baseRequest,
    headers: {
      ...(baseRequest?.headers || {}),
      "x-workspace-slug": String(workspaceSlug || "").trim(),
      "x-surface-id": String(surfaceId || "").trim().toLowerCase()
    }
  };
}
```

Why apps need this:

1. Lets websocket subscribe authorization reuse existing HTTP workspace resolver logic.

### `normalizeConnectionSurface(value)`

What it does:

1. Normalizes and validates handshake `surface` query value.
2. Return empty string (`""`) to reject unsupported surface.

Practical real-life example:

```js
function normalizeConnectionSurface(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "app" || normalized === "admin" || normalized === "console") {
    return normalized;
  }

  return "";
}
```

Why apps need this:

1. Surface vocabulary belongs to app policy, not shared runtime.

### `normalizeWorkspaceSlug(value)`

What it does:

1. Normalizes workspace slug for subscribe and fanout matching.

Practical real-life example:

```js
function normalizeWorkspaceSlug(value) {
  return String(value || "").trim().toLowerCase();
}
```

Why apps need this:

1. Avoids slug mismatch bugs (for example `Acme` vs `acme`).

---

## 10) Optional Hooks (Every Optional Function + Real Examples)

### `logger.info(payload, message)` and `logger.warn(payload, message)`

What it does:

1. Receives runtime startup/failure/fanout diagnostics.

Practical real-life example:

1. Forward logs to your centralized logger with structured metadata.
2. Alert when runtime falls back to in-memory adapter.

Example:

```js
const logger = {
  info(payload, message) {
    appLog.info(payload, message);
  },
  warn(payload, message) {
    appLog.warn(payload, message);
  }
};
```

### `redisClientFactory(options)`

What it does:

1. Creates Redis client instance used for adapter connection.
2. Default is `createClient` from `redis` package.

Practical real-life example:

1. In tests, inject fake client to simulate timeout or failure.
2. In production, keep default unless you need specialized client instrumentation.

Example:

```js
function redisClientFactory(options) {
  return createClient({
    ...options,
    socket: { connectTimeout: 2000 }
  });
}
```

### `redisStreamsAdapterFactory(redisClient)`

What it does:

1. Creates Socket.IO adapter bound to redis client.
2. Default is `createAdapter` from `@socket.io/redis-streams-adapter`.

Practical real-life example:

1. In tests, inject fake adapter to assert adapter wiring without real Redis.

Example:

```js
function redisStreamsAdapterFactory(redisClient) {
  return createAdapter(redisClient);
}
```

---

## 11) Exported Test Helpers (`__testables`) (Every Function + Real Examples)

These are exported for tests. Do not use them in normal app runtime wiring.

### `__testables.normalizeRedisQuitTimeoutMs(value, fallback)`

What it does:

1. Converts value to integer timeout.
2. Uses fallback if invalid.
3. Caps at `60000` ms.

Real-life example:

1. Input `90000` returns `60000`.
2. Input `0` returns fallback.

### `__testables.normalizeRedisConnectTimeoutMs(value, fallback)`

What it does:

1. Same normalization/capping behavior for connect timeout.

Real-life example:

1. Input `50` returns `50`.
2. Input `"bad"` returns fallback.

### `__testables.connectRedisClientWithTimeout(redisClient, { timeoutMs })`

What it does:

1. Calls `redisClient.connect()`.
2. Races it against timeout.
3. Throws with code `REDIS_CONNECT_TIMEOUT` if timed out.

Real-life example:

1. If Redis DNS is broken and connect hangs, startup fails quickly instead of waiting forever.

### `__testables.closeRedisClientWithTimeout(redisClient, { timeoutMs })`

What it does:

1. Attempts graceful `quit()` first.
2. If quit stalls/fails, force closes via `disconnect()` or `destroy()`.
3. Prevents shutdown hangs.

Real-life example:

1. During deploy termination, runtime closes promptly even if Redis `quit` is stuck.

---

## 12) Protocol Message Shapes (Client/Server)

This package uses message types from `@jskit-ai/realtime-contracts`.

Client to server:

1. `subscribe`
2. `unsubscribe`
3. `ping`

Server to client:

1. `subscribed`
2. `unsubscribed`
3. `pong`
4. `event`
5. `error`

### Subscribe request

```json
{
  "type": "subscribe",
  "requestId": "req-1",
  "workspaceSlug": "acme",
  "topics": ["projects"]
}
```

### Subscribed ack

```json
{
  "type": "subscribed",
  "requestId": "req-1",
  "workspaceSlug": "acme",
  "topics": ["projects"]
}
```

### Unsubscribe request

```json
{
  "type": "unsubscribe",
  "requestId": "req-2",
  "workspaceSlug": "acme",
  "topics": ["projects"]
}
```

### Ping / Pong

```json
{
  "type": "ping",
  "requestId": "ping-1",
  "ts": "2026-02-23T10:00:00.000Z"
}
```

```json
{
  "type": "pong",
  "requestId": "ping-1",
  "ts": "2026-02-23T10:00:00.000Z"
}
```

### Error response

```json
{
  "type": "error",
  "requestId": "req-1",
  "code": "forbidden",
  "message": "Forbidden."
}
```

### Fanout event envelope

```json
{
  "workspaceId": 11,
  "workspaceSlug": "acme",
  "topic": "projects",
  "eventType": "workspace.project.updated",
  "payload": {
    "projectId": "42"
  }
}
```

### Targeted event envelope

```json
{
  "topic": "chat",
  "eventType": "chat.message.created",
  "targetUserIds": [7, 9],
  "payload": {
    "messageId": "m_100"
  }
}
```

Note about targeted fanout:

1. Targeted events use user rooms and do not require topic-room subscription.

---

## 13) How Apps Use This Package In Real Terms (And Why)

First-day explanation:

1. The shared package is the engine.
2. The app wrapper is the adapter.
3. The wrapper exists to connect app policy into shared mechanics.

In this repo, the adapter is:

1. `apps/jskit-value-app/server/realtime/registerSocketIoRealtime.js`

What `registerSocketIoRealtime(...)` does, exactly:

1. Accepts app runtime dependencies.
These are things like `authService`, `workspaceService`, `realtimeEventsService`, and Redis/runtime options.
2. Injects app policy callbacks into shared runtime.
These are app-specific rules: `isSupportedTopic`, `isTopicAllowedForSurface`, `hasTopicPermission`, `buildSubscribeContextRequest`, `normalizeConnectionSurface`, `normalizeWorkspaceSlug`.
3. Delegates to the shared runtime entrypoint (`registerRealtimeServerSocketio(...)`).

What `registerSocketIoRealtime(...)` does NOT do:

1. It does not implement websocket protocol parsing.
2. It does not implement Socket.IO room fanout logic.
3. It does not implement Redis Streams adapter lifecycle logic.
4. It does not translate old API names (it is not a compatibility shim).

Why this wrapper is important:

1. It keeps business policy in app code (where it belongs).
2. It keeps transport/runtime mechanics in package code (where reuse belongs).
3. It gives every app one explicit wiring point instead of copy-pasting 1000+ lines of runtime internals.

Concrete startup call chain:

1. `server.js` calls `registerSocketIoRealtime(app, options)`.
2. Wrapper passes services + policy callbacks into package runtime.
3. Package runtime starts Socket.IO, attaches auth/protocol handlers, subscribes to event fanout, and registers shutdown cleanup.

Why this is positive for 10 apps:

1. Each app writes only policy and vocabulary.
2. Runtime behavior stays consistent across all apps.
3. Bug fixes in runtime mechanics are done once in one package.
4. New apps start faster by copying a small adapter pattern, not a full server runtime.

---

## 14) Complete App Integration Example

```js
import { registerRealtimeServerSocketio } from "@jskit-ai/realtime-server-socketio";

await registerRealtimeServerSocketio(fastify, {
  authService,
  realtimeEventsService,
  workspaceService,

  isSupportedTopic: (topic) => ["projects", "workspace_meta", "chat"].includes(String(topic || "").trim()),

  isTopicAllowedForSurface: (topic, surfaceId) => {
    if (topic === "workspace_meta") {
      return surfaceId === "app" || surfaceId === "admin";
    }

    if (topic === "projects") {
      return surfaceId === "app" || surfaceId === "admin";
    }

    if (topic === "chat") {
      return surfaceId === "app";
    }

    return false;
  },

  hasTopicPermission: (topic, permissions, surfaceId) => {
    const set = new Set(Array.isArray(permissions) ? permissions : []);

    if (topic === "workspace_meta") {
      return true;
    }

    if (topic === "projects") {
      return set.has("projects.read") || set.has("*");
    }

    if (topic === "chat" && surfaceId === "app") {
      return set.has("chat.read") || set.has("*");
    }

    return false;
  },

  buildSubscribeContextRequest: (baseRequest, workspaceSlug, surfaceId) => ({
    ...baseRequest,
    headers: {
      ...(baseRequest?.headers || {}),
      "x-workspace-slug": String(workspaceSlug || "").trim().toLowerCase(),
      "x-surface-id": String(surfaceId || "").trim().toLowerCase()
    }
  }),

  normalizeConnectionSurface: (value) => {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "app" || normalized === "admin" || normalized === "console") {
      return normalized;
    }

    return "";
  },

  normalizeWorkspaceSlug: (value) => String(value || "").trim().toLowerCase(),

  redisUrl: process.env.REDIS_URL || "",
  requireRedisAdapter: process.env.NODE_ENV === "production",
  path: "/api/realtime",
  maxInboundMessageBytes: 8192,
  redisQuitTimeoutMs: 5000,
  redisConnectTimeoutMs: 5000
});
```

---

## 15) Troubleshooting

1. **Handshake fails with `unauthorized`**
Check `authService.authenticateRequest` return values and session parsing.

2. **Connection fails with `unsupported_surface`**
Check client query (`surface=...`) and `normalizeConnectionSurface` behavior.

3. **Subscribe gets `forbidden`**
Check `isTopicAllowedForSurface`, workspace membership resolution, and `hasTopicPermission`.

4. **Events do not arrive**
Check that event envelope has valid `workspaceId`, `workspaceSlug`, and `topic` for non-targeted events.

5. **Redis adapter fails on startup**
Check Redis connectivity; consider `requireRedisAdapter: false` in non-critical environments.

6. **Server shutdown hangs**
Check Redis client behavior; tune `redisQuitTimeoutMs`.

---

## 16) Common Mistakes

1. Putting app topic vocabulary directly in this package.
2. Returning inconsistent slug normalization across code paths.
3. Forgetting `realtimeEventsService.subscribe` must return an unsubscribe function.
4. Assuming subscribe-time auth is enough (runtime also re-checks during fanout).
5. Using `__testables` helpers in production runtime code.
6. Treating client runtime and server runtime as one package.
