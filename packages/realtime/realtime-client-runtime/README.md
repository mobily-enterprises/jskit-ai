# `@jskit-ai/realtime-client-runtime`

Reusable client realtime runtime for SaaS apps.

Plain-language summary:
This package handles connection/reconnect mechanics and command/event replay mechanics. Your app still decides which topics exist, which permissions are required, and what to do when events arrive.

---

## Table Of Contents

1. [What This Package Is For](#1-what-this-package-is-for)
2. [What This Package Does Not Do](#2-what-this-package-does-not-do)
3. [Quick Mental Model](#3-quick-mental-model)
4. [Install](#4-install)
5. [Quick Start](#5-quick-start)
6. [API Reference](#6-api-reference)
7. [How Apps Use This Package (Real Terms + Why)](#7-how-apps-use-this-package-real-terms--why)
8. [Common Mistakes](#8-common-mistakes)

---

## 1) What This Package Is For

Use this package when you need shared realtime client runtime behavior across multiple apps:

1. Open and close websocket-style connections safely.
2. Reconnect with bounded backoff.
3. Send subscribe commands and correlate subscribe acknowledgements.
4. Track local commands (`pending` / `acked` / `failed`).
5. Defer and replay self-events when local commands fail.

Practical benefit:

1. You write connection/replay mechanics once.
2. Each app keeps its own business policy and cache invalidation rules.

---

## 2) What This Package Does Not Do

This package intentionally does not:

1. Define app topic names.
2. Define app event names.
3. Decide app authorization policy.
4. Invalidate app query caches.
5. Depend on Vue/React or app stores.

Why this matters:
Reusable package code stays app-agnostic and low-coupling.

---

## 3) Quick Mental Model

Think of two layers:

1. Runtime layer (`@jskit-ai/realtime-client-runtime`)
2. App adapter layer (your app-specific eligibility + event handling)

Flow:

```text
App state/policy -> App adapter callbacks -> realtime-client-runtime -> socket transport
```

---

## 4) Install

In your app workspace `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/realtime-client-runtime": "0.1.0"
  }
}
```

From monorepo root:

```bash
npm install
```

---

## 5) Quick Start

```js
import {
  createCommandTracker,
  createRealtimeRuntime,
  createSocketIoTransport
} from "@jskit-ai/realtime-client-runtime";

const commandTracker = createCommandTracker();

const runtime = createRealtimeRuntime({
  commandTracker,
  resolveEligibility: () => ({
    eligible: true,
    fingerprint: "app:1:acme:projects",
    subscribePayload: {
      workspaceSlug: "acme",
      topics: ["projects"]
    }
  }),
  onEvent: async (eventEnvelope) => {
    console.log("handle event", eventEnvelope);
  },
  onSubscribed: async ({ subscribePayload }) => {
    console.log("subscribed", subscribePayload);
  },
  transport: createSocketIoTransport(),
  buildRealtimeUrl: () => "https://example.test"
});

runtime.start();
// later
runtime.stop();
```

---

## 6) API Reference

### `createCommandTracker(options?)`

Creates an in-memory tracker for command and event correlation.

Real use case:
When your API call sends `commandId`, mark that command as pending immediately, then mark it `acked` or `failed` when request completes.

```js
import { createCommandTracker } from "@jskit-ai/realtime-client-runtime";

const tracker = createCommandTracker();
tracker.markCommandPending("cmd_123", { feature: "projects" });
tracker.markCommandAcked("cmd_123");
```

#### Common tracker instance methods

1. `markCommandPending(commandId, meta?)`
Purpose: mark a command as in-flight.
Example: before `POST /projects`.

2. `markCommandAcked(commandId)`
Purpose: mark pending command as successful.
Example: server returned success for that command.

3. `markCommandFailed(commandId, reason?)`
Purpose: mark pending command as failed.
Example: request failed with network timeout.

4. `getCommandState(commandId)`
Purpose: inspect state (`pending`, `acked`, `failed`, `unknown`).
Example: event handler checks if a self-event should be deferred.

5. `deferSelfEvent(eventEnvelope)`
Purpose: queue self-event while local command is still pending.
Example: realtime event arrives before request finishes.

6. `drainDeferredEventsForCommand(commandId)`
Purpose: replay queued events after command finalization.
Example: when command failed and UI must reconcile from server event.

7. `subscribeFinalization(listener)`
Purpose: react to `acked` / `failed` transitions.
Example: runtime hooks replay processing on failures.

### `createRealtimeRuntime(options)`

Creates a runtime instance with `start()` and `stop()`.

Required options:

1. `commandTracker`
2. `resolveEligibility()`
3. `onEvent(event, context)`

Important optional options:

1. `onSubscribed(payload)`
2. `onEvents(events, context)`
3. `isSubscribeAckMatch({ message, tracking, eligibility })`
4. `onConnectionStateChange(statePayload)`
5. `transport`
6. `buildRealtimeUrl()`
7. `surface`
8. `messageTypes`
9. `errorCodes`
10. `reconnectPolicy`
11. `replayPolicy`
12. `maintenanceIntervalMs`

Practical real example:

```js
const runtime = createRealtimeRuntime({
  commandTracker,
  resolveEligibility: () => ({
    eligible: isSignedIn && Boolean(activeWorkspaceSlug),
    fingerprint: `${surface}:${isSignedIn ? 1 : 0}:${activeWorkspaceSlug}`,
    subscribePayload: {
      workspaceSlug: activeWorkspaceSlug,
      topics: resolveAllowedTopics()
    }
  }),
  onEvent: async (eventEnvelope, context) => {
    await appRealtimeHandlers.processEvent(eventEnvelope, context);
  },
  onSubscribed: async ({ subscribePayload }) => {
    await appRealtimeHandlers.reconcileTopics(subscribePayload);
  }
});
```

### `createSocketIoTransport(options?)`

Creates the default socket transport adapter used by runtime.

Real use case:
Keep socket-specific options (`path`, `messageEvent`, `transports`) outside runtime business logic.

```js
import { createSocketIoTransport } from "@jskit-ai/realtime-client-runtime";

const transport = createSocketIoTransport({
  path: "/api/realtime",
  messageEvent: "realtime:message",
  query: { tenant: "acme" }
});
```

### `createReconnectPolicy(options?)`

Creates bounded exponential reconnect timing policy.

Real use case:
Tune reconnect aggressiveness for staging vs production.

```js
import { createReconnectPolicy } from "@jskit-ai/realtime-client-runtime";

const reconnectPolicy = createReconnectPolicy({
  baseDelayMs: 300,
  maxDelayMs: 8000,
  jitterRatio: 0.2
});
```

### `createReplayPolicy(options?)`

Creates deferred replay limits.

Real use case:
Protect UI thread and memory by capping replay volume per command/tick.

```js
import { createReplayPolicy } from "@jskit-ai/realtime-client-runtime";

const replayPolicy = createReplayPolicy({
  maxEventsPerCommand: 25,
  maxEventsPerTick: 75
});
```

---

## 7) How Apps Use This Package (Real Terms + Why)

Typical app adapter responsibilities:

1. Build `resolveEligibility()` from app auth/workspace state.
2. Build `onEvent()` using app query invalidation/event bus logic.
3. Build `onSubscribed()` to run app-specific reconciliation.
4. Keep topic catalogs, permissions, and policy in app code.

Why this split scales for many SaaS apps:

1. Runtime bugs are fixed once in shared package.
2. New apps reuse runtime without inheriting unrelated product policy.
3. App teams can change topics/permissions without touching package internals.

---

## 8) Common Mistakes

1. Putting topic constants into this package.
Keep those in each app.

2. Putting cache invalidation logic into this package.
Do invalidation in app `onEvent()` handlers.

3. Reusing one global tracker across unrelated browser contexts.
Create one tracker per app runtime instance.

4. Returning unstable fingerprints from `resolveEligibility()`.
Fingerprint should change only when connection identity/subscribe payload changes.
