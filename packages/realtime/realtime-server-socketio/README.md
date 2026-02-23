# `@jskit-ai/realtime-server-socketio`

Reusable Socket.IO realtime server runtime for SaaS apps.

Plain-language summary:
This package runs the generic websocket server lifecycle: connect, authenticate, subscribe/unsubscribe, fanout, and shutdown. Your app still decides who can subscribe to what, and how workspace/user context is resolved.

---

## Table Of Contents

1. [What This Package Is For](#1-what-this-package-is-for)
2. [What This Package Does Not Do](#2-what-this-package-does-not-do)
3. [Quick Mental Model](#3-quick-mental-model)
4. [Install](#4-install)
5. [Public API](#5-public-api)
6. [Function Reference (Every Export + Practical Examples)](#6-function-reference-every-export--practical-examples)
7. [How Apps Use It In Real Terms (And Why)](#7-how-apps-use-it-in-real-terms-and-why)
8. [End-To-End Example](#8-end-to-end-example)
9. [Troubleshooting](#9-troubleshooting)
10. [Common Mistakes](#10-common-mistakes)

---

## 1) What This Package Is For

Use this package when multiple apps need the same Socket.IO server mechanics:

1. Websocket transport setup.
2. Handshake authentication flow.
3. Subscribe/unsubscribe protocol handling.
4. Room fanout and targeted fanout helpers.
5. Redis Streams adapter wiring (optional/required mode).
6. Graceful on-close teardown.

Practical value:

1. You do this hard infrastructure code once.
2. Every app reuses stable behavior.
3. App-specific authorization and topic policy stay in app code.

---

## 2) What This Package Does Not Do

This package intentionally does not:

1. Hardcode topic names.
2. Hardcode permission strings.
3. Hardcode workspace/user schema assumptions.
4. Hardcode app-specific auth/business policy.
5. Produce domain events.

Why this matters:
The package stays reusable across many SaaS apps with different domain vocabulary.

---

## 3) Quick Mental Model

There are two layers:

1. Shared runtime layer (`@jskit-ai/realtime-server-socketio`).
2. App policy layer (your auth, workspace resolution, topic rules).

Flow:

```text
Socket connects
  -> runtime authenticates request (app auth service)
  -> runtime validates subscribe message
  -> runtime asks app policy: allowed topic/surface/permission?
  -> runtime stores subscription and joins socket room
  -> app publishes domain event to realtimeEventsService
  -> runtime fans out event to eligible subscribed sockets
```

---

## 4) Install

In app workspace `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/realtime-server-socketio": "0.1.0"
  }
}
```

From monorepo root:

```bash
npm install
```

---

## 5) Public API

```js
import {
  registerRealtimeServerSocketio,
  SOCKET_IO_PATH,
  SOCKET_IO_MESSAGE_EVENT,
  MAX_INBOUND_MESSAGE_BYTES,
  __testables
} from "@jskit-ai/realtime-server-socketio";
```

---

## 6) Function Reference (Every Export + Practical Examples)

### `registerRealtimeServerSocketio(fastify, options)`

Registers the Socket.IO realtime runtime and returns the Socket.IO server instance.

This is the main function.

#### Required `options`

1. `authService`
Must expose `authenticateRequest(requestContext)`.
Real-life use: verify session cookie/JWT during websocket handshake.

2. `realtimeEventsService`
Must expose `subscribe(listener)` and return `unsubscribe()`.
Real-life use: consume normalized domain events and fan out to connected sockets.

3. `workspaceService`
Must expose `resolveRequestContext({ user, request, workspacePolicy, workspaceSurface })`.
Real-life use: resolve workspace + permission context for subscribe authorization.

4. `isSupportedTopic(topic)`
App callback to validate topic vocabulary.
Real-life use: reject typo/unsupported topics early.

5. `isTopicAllowedForSurface(topic, surfaceId)`
App callback to enforce surface rules.
Real-life use: deny admin-only topic on app surface.

6. `hasTopicPermission(topic, permissions, surfaceId)`
App callback to enforce permission policy.
Real-life use: only `projects.read` members can subscribe to `projects`.

7. `buildSubscribeContextRequest(baseRequest, workspaceSlug, surfaceId)`
App callback building request object for workspace authorization.
Real-life use: add `x-workspace-slug` and `x-surface-id` headers for context resolution.

8. `normalizeConnectionSurface(value)`
App callback to normalize/validate surface ids.
Real-life use: map malformed or missing input to your canonical surface behavior.

9. `normalizeWorkspaceSlug(value)`
App callback to sanitize workspace slugs.
Real-life use: trim/validate user input before policy lookup.

#### Optional `options`

1. `redisUrl` (default `""`)
If set, runtime attempts Redis Streams adapter.

2. `requireRedisAdapter` (default `false`)
When `true`, startup fails if Redis adapter cannot connect.
Real-life use: production strict mode.

3. `logger` (default app logger)
Supports `info(payload, message)` and `warn(payload, message)`.

4. `path` (default `SOCKET_IO_PATH`)
Socket.IO endpoint path.

5. `maxInboundMessageBytes` (default `MAX_INBOUND_MESSAGE_BYTES`)
Inbound payload cap.
Real-life use: close abusive oversized frames safely.

6. `redisQuitTimeoutMs` / `redisConnectTimeoutMs`
Timeout controls for Redis lifecycle.

7. `redisClientFactory`
Inject custom redis client factory (useful for tests).

8. `redisStreamsAdapterFactory`
Inject custom adapter factory (useful for tests/custom wiring).

#### Practical example

```js
await registerRealtimeServerSocketio(fastify, {
  authService,
  realtimeEventsService,
  workspaceService,
  isSupportedTopic,
  isTopicAllowedForSurface,
  hasTopicPermission,
  buildSubscribeContextRequest,
  normalizeConnectionSurface,
  normalizeWorkspaceSlug,
  redisUrl: process.env.REDIS_URL,
  requireRedisAdapter: process.env.NODE_ENV === "production"
});
```

Why this is useful:

1. Runtime does protocol + fanout mechanics.
2. App injects policy decisions.
3. You avoid coupling shared runtime to one product’s vocabulary.

---

### `SOCKET_IO_PATH`

Default Socket.IO path constant.
Current value: `"/api/realtime"`.

Real-life use:
Reuse this value in test harnesses and reverse-proxy config.

```js
const socketUrl = `ws://localhost:3000${SOCKET_IO_PATH}?surface=app`;
```

---

### `SOCKET_IO_MESSAGE_EVENT`

Default event channel name for realtime protocol messages.
Current value: `"realtime:message"`.

Real-life use:
Your clients send/receive protocol payloads on this channel.

```js
socket.emit(SOCKET_IO_MESSAGE_EVENT, {
  type: "subscribe",
  workspaceSlug: "acme",
  topics: ["projects"]
});
```

---

### `MAX_INBOUND_MESSAGE_BYTES`

Default inbound message size limit.
Current value: `8192` bytes.

Real-life use:
Protects server from oversized websocket payloads.

---

### `__testables`

Test-only helper exports:

1. `normalizeRedisQuitTimeoutMs`
2. `normalizeRedisConnectTimeoutMs`
3. `connectRedisClientWithTimeout`
4. `closeRedisClientWithTimeout`

Use these in tests, not in app business logic.

Practical example:

```js
assert.equal(__testables.normalizeRedisQuitTimeoutMs(90_000, 900), 60_000);
```

---

## 7) How Apps Use It In Real Terms (And Why)

Typical app integration pattern:

1. Keep topic catalog and permission policy in app module.
2. Keep auth + workspace resolution services in app server domain.
3. Call `registerRealtimeServerSocketio` at server bootstrap.
4. Publish domain events through app realtime event service.
5. Let runtime fan out only to authorized subscribed sockets.

Why this helps in a monorepo with many apps:

1. Shared runtime removes repeated low-level websocket/redis logic.
2. App-specific policy remains local and explicit.
3. Onboarding new app is faster: reuse runtime, inject app callbacks.

---

## 8) End-To-End Example

```js
import { registerRealtimeServerSocketio } from "@jskit-ai/realtime-server-socketio";

await registerRealtimeServerSocketio(fastify, {
  authService,
  realtimeEventsService,
  workspaceService,
  isSupportedTopic: (topic) => ["projects", "workspace_meta"].includes(topic),
  isTopicAllowedForSurface: (topic, surfaceId) => {
    if (topic === "projects") {
      return surfaceId === "app" || surfaceId === "admin";
    }
    return topic === "workspace_meta" && surfaceId === "app";
  },
  hasTopicPermission: (topic, permissions) => {
    if (topic === "workspace_meta") {
      return true;
    }
    return Array.isArray(permissions) && permissions.includes("projects.read");
  },
  buildSubscribeContextRequest: (baseRequest, workspaceSlug, surfaceId) => ({
    ...baseRequest,
    headers: {
      ...(baseRequest?.headers || {}),
      "x-workspace-slug": workspaceSlug,
      "x-surface-id": surfaceId
    }
  }),
  normalizeConnectionSurface: (value) => String(value || "").trim().toLowerCase() || "app",
  normalizeWorkspaceSlug: (value) => String(value || "").trim(),
  redisUrl: process.env.REDIS_URL || "",
  requireRedisAdapter: process.env.NODE_ENV === "production"
});
```

---

## 9) Troubleshooting

1. **Handshake rejected with unauthorized**
Check `authService.authenticateRequest` and cookie/header extraction in your request context.

2. **Subscribe returns forbidden**
Check:
1. `isTopicAllowedForSurface`
2. `workspaceService.resolveRequestContext`
3. `hasTopicPermission`

3. **No events received**
Check:
1. event contains correct `workspaceId`, `workspaceSlug`, and `topic`
2. socket subscribed to same topic/workspace
3. event fanout logs (`realtime.socketio.*`)

4. **Redis mode unstable**
Check `redisConnectTimeoutMs`, `redisQuitTimeoutMs`, and network reachability.

---

## 10) Common Mistakes

1. Putting app-specific topic constants into this package.
Keep topic vocabulary in app code.

2. Skipping `normalizeWorkspaceSlug` validation.
Leads to inconsistent subscribe/fanout matching.

3. Allowing subscribe without surface checks.
Can leak admin topics to app surface.

4. Forgetting to return `unsubscribe` from `realtimeEventsService.subscribe`.
Can leak listeners during shutdown.

