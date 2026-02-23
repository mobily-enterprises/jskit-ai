# `@jskit-ai/realtime-client-runtime`

Reusable client realtime runtime for SaaS apps.

Plain-language summary:
This package is the shared "engine" for client realtime connection behavior. It handles connect/reconnect, subscribe command tracking, and deferred event replay. Your app still owns business policy, topic rules, and cache invalidation decisions.

---

## Table Of Contents

1. [Who This Is For](#1-who-this-is-for)
2. [What This Package Is For](#2-what-this-package-is-for)
3. [What This Package Does Not Do](#3-what-this-package-does-not-do)
4. [Beginner Glossary](#4-beginner-glossary)
5. [Quick Mental Model](#5-quick-mental-model)
6. [Install](#6-install)
7. [Export Catalog (Everything This Package Exposes)](#7-export-catalog-everything-this-package-exposes)
8. [Function Reference (Every Function + Real-Life Examples)](#8-function-reference-every-function--real-life-examples)
9. [How Apps Use This Package In Real Terms (And Why)](#9-how-apps-use-this-package-in-real-terms-and-why)
10. [End-To-End Example](#10-end-to-end-example)
11. [Troubleshooting For Beginners](#11-troubleshooting-for-beginners)
12. [Common Mistakes](#12-common-mistakes)

---

## 1) Who This Is For

This README is written for developers who:

1. Need realtime updates in a frontend app.
2. Are not realtime protocol experts.
3. Want a reliable shared runtime across multiple apps.
4. Need practical guidance, not just API signatures.

---

## 2) What This Package Is For

Use this package to share the mechanical parts of realtime clients:

1. Connect and reconnect to the realtime server.
2. Send subscribe messages and verify subscribe acknowledgements.
3. Track local commands (`pending`, `acked`, `failed`).
4. Defer self-events while the local command is still pending.
5. Replay deferred events if a command fails or expires.

Practical value in real apps:

1. You do not rewrite reconnect logic for each app.
2. You get consistent behavior for command/event race conditions.
3. You keep app business policy out of shared runtime code.

---

## 3) What This Package Does Not Do

This package intentionally does not:

1. Define your topic names.
2. Define your event names.
3. Define your permission model.
4. Invalidate query caches.
5. Depend on Vue/React/Pinia/Zustand/etc.

Why this boundary matters:

1. Shared package remains reusable and low-coupling.
2. App-specific language and policy stay in the app.

---

## 4) Beginner Glossary

1. **Realtime event**: a message pushed from server to client (example: "project.updated").
2. **Command**: a local action correlated with events (example: create project request with `commandId`).
3. **Self-event**: an event caused by the same client that initiated a command.
4. **Deferred event**: a self-event temporarily stored instead of processed immediately.
5. **Eligibility**: whether runtime should connect and subscribe right now.
6. **Fingerprint**: stable identity string for current connection/subscription context.
7. **Subscribe payload**: the fields sent with subscribe request (example: workspace + topics).

---

## 5) Quick Mental Model

Think in two layers:

1. **Shared runtime layer** (`@jskit-ai/realtime-client-runtime`)
2. **App adapter layer** (your auth/workspace/topic/event policy)

Flow:

```text
App state and policy
  -> app adapter callbacks (resolveEligibility/onEvent/onSubscribed)
  -> realtime-client-runtime
  -> socket transport
  -> realtime server
```

---

## 6) Install

In app workspace `package.json`:

```json
{
  "dependencies": {
    "@jskit-ai/realtime-client-runtime": "0.1.0"
  }
}
```

Install from monorepo root:

```bash
npm install
```

---

## 7) Export Catalog (Everything This Package Exposes)

```js
import {
  createCommandTracker,
  DEFAULT_COMMAND_TRACKER_OPTIONS,
  createRealtimeRuntime,
  runtimeTestables,
  createSocketIoTransport,
  assertRealtimeTransport,
  DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS,
  createReconnectPolicy,
  DEFAULT_RECONNECT_POLICY,
  createReplayPolicy,
  DEFAULT_REPLAY_POLICY
} from "@jskit-ai/realtime-client-runtime";
```

What each export is for:

1. `createCommandTracker`: creates command/event correlation tracker.
2. `DEFAULT_COMMAND_TRACKER_OPTIONS`: default tracker timings and limits.
3. `createRealtimeRuntime`: creates the runtime with `start()` and `stop()`.
4. `runtimeTestables`: low-level helpers for tests.
5. `createSocketIoTransport`: default Socket.IO transport adapter.
6. `assertRealtimeTransport`: validates custom transport contracts.
7. `DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS`: default socket path/message event/transports.
8. `createReconnectPolicy`: builds exponential backoff policy.
9. `DEFAULT_RECONNECT_POLICY`: default reconnect values.
10. `createReplayPolicy`: builds deferred replay limits.
11. `DEFAULT_REPLAY_POLICY`: default replay limits.

---

## 8) Function Reference (Every Function + Real-Life Examples)

### `createCommandTracker(options?)`

Creates an in-memory tracker for command state and deferred-event handling.

Real-life scenario:
You submit `POST /projects` with `commandId=cmd_42`. A realtime `project.created` event arrives before the request resolves. Tracker can defer that event until command outcome is known.

#### `options`

All options are optional.

1. `commandTtlMs` (default `30000`)
Meaning: how long `pending` command entries stay valid.
Real example: if request never resolves, mark as expired after 30s.

2. `finalizedTtlMs` (default `60000`)
Meaning: how long `acked` and `failed` command records remain for correlation.
Real example: late duplicate event can still be recognized for a short period.

3. `seenEventTtlMs` (default `120000`)
Meaning: duplicate-event detection window.
Real example: if server retries same event id, second copy is treated as duplicate.

4. `deferredEventTtlMs` (default `60000`)
Meaning: how long deferred event queues live per command.
Real example: stale deferred events are auto-pruned.

5. `maxCommandEntries` (default `1000`)
Meaning: cap for pending/acked/failed maps.
Real example: long-running tab does not grow memory without bound.

6. `maxSeenEvents` (default `4000`)
Meaning: cap for event dedupe memory.
Real example: high-volume event streams remain memory-safe.

7. `maxDeferredCommands` (default `500`)
Meaning: max command queues that can hold deferred events.

8. `maxDeferredEventsPerCommand` (default `25`)
Meaning: max deferred events for one command.

9. `maxDeferredEventsTotal` (default `2000`)
Meaning: global deferred-event cap across commands.

10. `now` (optional function)
Meaning: custom clock source.
Real example: deterministic unit tests.

11. `random` (optional function)
Meaning: custom randomness source for anonymous deferred-event keys.
Real example: deterministic snapshots/tests.

#### Tracker instance methods (all of them)

Use pattern:

```js
const tracker = createCommandTracker();
```

1. `markCommandPending(commandId, meta?)`
What it does: records new pending command if unknown.
Returns: `true` if newly tracked, `false` if invalid or already known.
Real example:

```js
tracker.markCommandPending("cmd_create_project", {
  feature: "projects",
  workspaceSlug: "acme"
});
```

2. `markCommandAcked(commandId)`
What it does: moves pending command to acked.
Returns: `true` only if command was pending.
Real example:

```js
await api.projects.create(payload);
tracker.markCommandAcked("cmd_create_project");
```

3. `markCommandFailed(commandId, reason?)`
What it does: moves pending command to failed.
Returns: `true` only if command was pending.
Real example:

```js
try {
  await api.projects.create(payload);
} catch {
  tracker.markCommandFailed("cmd_create_project", "network");
}
```

4. `getCommandState(commandId)`
What it does: returns `"pending" | "acked" | "failed" | "unknown"`.
Real example:

```js
if (tracker.getCommandState(commandId) === "pending") {
  // hold this self-event for now
}
```

5. `isKnownLocalCommand(commandId)`
What it does: `true` when state is `pending` or `acked`.
Real example: ignore remote command IDs you never issued.

6. `deferSelfEvent(eventEnvelope)`
What it does: stores event by `commandId` for later replay.
Returns: `false` for invalid or duplicate deferred events.
Real example:

```js
tracker.deferSelfEvent({
  eventId: "evt_100",
  commandId: "cmd_create_project",
  topic: "projects"
});
```

7. `drainDeferredEventsForCommand(commandId)`
What it does: returns and removes deferred events for a command.
Real example: replay after command failure.

8. `dropDeferredEventsForCommand(commandId)`
What it does: removes deferred queue without replay.
Real example: command succeeded, deferred self-events are no longer needed.

9. `markEventSeenAndCheckDuplicate(eventId)`
What it does: dedupe helper.
Returns: `true` if event was already seen, else `false` and marks it seen.
Real example:

```js
if (tracker.markEventSeenAndCheckDuplicate(event.eventId)) {
  return; // duplicate delivery
}
```

10. `pruneExpired(now?)`
What it does: removes expired tracker entries.
Real example: periodic maintenance loop in runtime.

11. `collectExpiredPendingCommands(now?)`
What it does: finds pending commands that exceeded TTL.
Real example: runtime marks those as failed and replays deferred events.

12. `subscribeFinalization(listener)`
What it does: listener for command final states.
Returns: unsubscribe function.
Real example:

```js
const unsubscribe = tracker.subscribeFinalization(({ commandId, state }) => {
  if (state === "failed") {
    console.warn("command failed", commandId);
  }
});
```

13. `listDeferredCommandIds()`
What it does: list command IDs that currently have deferred queues.
Real example: batch replay sweep.

14. `resetForTests()`
What it does: clears tracker state.
Real example: each unit test starts from clean tracker memory.

#### `tracker.__testables`

Testing-only internals for white-box tests:

1. Internal maps for pending/acked/failed/seen/deferred entries.
2. Resolved cap values for deferred queues.

Use this only in tests, not production feature code.

---

### `createRealtimeRuntime(options)`

Creates runtime instance with:

1. `start()`
2. `stop()`

#### Required `options`

1. `commandTracker`
What it is: tracker instance from `createCommandTracker`.
Why required: runtime uses it for replay and command finalization behavior.

2. `resolveEligibility({ surface })`
What it is: app callback that returns current connect/subscribe context.
Must return object with:
1. `eligible` (`boolean`)
2. `subscribePayload` (`object`)
3. `fingerprint` (`string`, optional but strongly recommended)

Real example:

```js
resolveEligibility: () => {
  const workspaceSlug = workspaceStore.activeWorkspaceSlug;
  const isSignedIn = authStore.isAuthenticated;
  const topics = resolveTopicsForCurrentPermissions();

  return {
    eligible: Boolean(isSignedIn && workspaceSlug && topics.length > 0),
    fingerprint: `app:${isSignedIn ? 1 : 0}:${workspaceSlug}:${topics.join(",")}`,
    subscribePayload: {
      workspaceSlug,
      topics
    }
  };
};
```

3. `onEvent(eventEnvelope, context)`
What it is: app callback invoked for each realtime event.
Why required: runtime is app-agnostic and cannot decide event business behavior.

Real example:

```js
onEvent: async (eventEnvelope, context) => {
  await appEventHandlers.processEvent(eventEnvelope, context);
};
```

#### Optional `options`

1. `onEvents(events, context)`
What it does: batch event handler for deferred replay batches.
Real example: replay 20 deferred events in one cache transaction.

2. `onSubscribed(payload)`
What it does: callback after subscribe ack is validated.
Real example: invalidate list queries for currently subscribed topics.

3. `isSubscribeAckMatch({ message, tracking, eligibility })`
What it does: custom validation that subscribe ack matches request.
Real example: enforce exact workspace slug and topic set match.

4. `isEventDeferred(event, context)`
What it does: callback to decide whether incoming socket event should be deferred.
Real example: defer self-event while command is still `pending`.

5. `onConnectionStateChange(statePayload)`
What it does: observability callback for runtime transitions.
Real example: show "Reconnecting..." banner when `state === "reconnect_scheduled"`.

6. `transport`
What it does: custom transport adapter object.
Real example: custom socket wrapper with your own telemetry.

7. `buildRealtimeUrl({ surface })`
What it does: custom URL resolver.
Real example: route admin surface to a dedicated realtime host.

8. `surface`
What it does: app surface id passed into eligibility + transport.
Real example: `"app"`, `"admin"`, `"console"`.

9. `messageTypes`
What it does: override protocol message names.
Real example: non-default server envelope type names.

10. `errorCodes`
What it does: override protocol error codes.
Real example: custom forbidden code name in legacy systems.

11. `reconnectPolicy`
What it does: reconnect delay policy.
Real example: aggressive reconnect in internal tools, conservative in public apps.

12. `replayPolicy`
What it does: deferred replay caps per command and per sweep tick.
Real example: lower caps on low-memory mobile clients.

13. `maintenanceIntervalMs`
What it does: periodic sweep interval.
Real example: 1s in default usage; slower for low-power scenarios.

14. Testing hooks: `now`, `random`, `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`
What they do: deterministic runtime tests.

15. Transport construction shortcut fields (used when `transport` is omitted):
1. `socketFactory`
2. `socketPath`
3. `messageEvent`
4. `transports`
5. `query`

#### Runtime methods

1. `start()`
What it does:
1. Starts maintenance loop.
2. Subscribes to command finalization events.
3. Evaluates eligibility and connects if eligible.

Real app example:

```js
const runtime = createRealtimeRuntime({...});
runtime.start(); // after app bootstrap/auth hydration
```

2. `stop()`
What it does:
1. Stops maintenance loop.
2. Unsubscribes finalization listener.
3. Clears reconnect timers.
4. Disconnects active socket.

Real app example:

```js
runtime.stop(); // when app unmounts or user signs out
```

#### Connection state events emitted via `onConnectionStateChange`

Possible states include:

1. `started`
2. `connecting`
3. `connected`
4. `subscribed`
5. `reconnect_scheduled`
6. `connect_error`
7. `forbidden`
8. `disconnected`
9. `idle`
10. `stopped`

Real example:

```js
onConnectionStateChange: ({ state, delayMs }) => {
  if (state === "reconnect_scheduled") {
    toast.info(`Realtime reconnecting in ${delayMs}ms`);
  }
}
```

---

### `createSocketIoTransport(options?)`

Creates default transport adapter used by runtime.

#### `options`

1. `socketFactory` (default `socket.io-client` `io`)
Real example: provide fake socket factory for tests.

2. `path` (default `"/api/realtime"`)
Real example: backend mounts realtime endpoint at `/ws/realtime`.

3. `messageEvent` (default `"realtime:message"`)
Real example: server uses a different emit/listen event key.

4. `transports` (default `["websocket"]`)
Real example: allow fallback transport if your environment requires it.

5. `query` (default `{}`)
Real example: include static tenant hint for gateway routing.

#### Returned transport contract

1. `messageEvent`
2. `createConnection({ url, surface })`

Real example:

```js
const transport = createSocketIoTransport({
  path: "/api/realtime",
  query: { deployment: "prod-us" }
});
```

---

### `assertRealtimeTransport(transport)`

Validates a custom transport object.

Checks:

1. `transport` is an object.
2. `transport.createConnection` exists and is a function.
3. `transport.messageEvent` exists and is a non-empty string.

Real-life example:
Before passing a custom transport plugin from another team, validate it up front so runtime fails fast with clear errors.

---

### `createReconnectPolicy(options?)`

Creates bounded exponential backoff policy object with `nextDelay(attempt)`.

#### `options`

1. `baseDelayMs` (default `500`)
2. `maxDelayMs` (default `10000`)
3. `jitterRatio` (default `0.2`)
4. `random` (optional deterministic random fn for tests)

Real-life example:
If your backend scales up slowly after deploy, use a larger base delay to reduce reconnect storms.

```js
const reconnectPolicy = createReconnectPolicy({
  baseDelayMs: 1000,
  maxDelayMs: 15000,
  jitterRatio: 0.25
});
```

---

### `createReplayPolicy(options?)`

Creates replay limits object.

#### `options`

1. `maxEventsPerCommand` (default `25`)
2. `maxEventsPerTick` (default `75`)

Real-life example:
A high-traffic app can lower `maxEventsPerTick` to avoid long UI-blocking replay bursts.

```js
const replayPolicy = createReplayPolicy({
  maxEventsPerCommand: 15,
  maxEventsPerTick: 40
});
```

---

### Default constants exports

1. `DEFAULT_COMMAND_TRACKER_OPTIONS`
2. `DEFAULT_SOCKET_IO_TRANSPORT_OPTIONS`
3. `DEFAULT_RECONNECT_POLICY`
4. `DEFAULT_REPLAY_POLICY`

Why useful:

1. Docs/debugging: show current package defaults in one place.
2. Config UI: present defaults to operators.

---

### `runtimeTestables` (testing helper export)

Testing-oriented helpers from runtime module:

1. `resolveConfiguredRealtimeUrl`
2. `buildRealtimeUrl`
3. `resolveEligibilityFingerprint`
4. `defaultIsSubscribeAckMatch`

Use these in tests only. Avoid production feature dependencies on test helpers.

---

## 9) How Apps Use This Package In Real Terms (And Why)

In a real SaaS app, your integration usually looks like this:

1. **Build tracker once** in client startup.
2. **Mark commands** in your HTTP transport layer when requests are sent/finished.
3. **Build app-specific event handlers** that do cache invalidation/event bus publishing.
4. **Build `resolveEligibility`** from auth + workspace + permission context.
5. **Create runtime** with callbacks and start it.
6. **Stop runtime** when app tears down/signs out.

Why this design works:

1. Shared runtime handles hard realtime edge cases consistently.
2. App teams keep domain vocabulary and policy inside app code.
3. Multi-app monorepos avoid copy-paste realtime engines.

---

## 10) End-To-End Example

```js
import {
  createCommandTracker,
  createRealtimeRuntime,
  createSocketIoTransport
} from "@jskit-ai/realtime-client-runtime";

const commandTracker = createCommandTracker();

// API layer marks command lifecycle.
async function createProject(api, payload) {
  const commandId = `cmd_${Date.now()}`;
  commandTracker.markCommandPending(commandId, { feature: "projects" });

  try {
    await api.projects.create({ ...payload, commandId });
    commandTracker.markCommandAcked(commandId);
  } catch (error) {
    commandTracker.markCommandFailed(commandId, error?.code || "request_failed");
    throw error;
  }
}

const runtime = createRealtimeRuntime({
  commandTracker,
  surface: "app",
  resolveEligibility: () => {
    const isSignedIn = authStore.isAuthenticated;
    const workspaceSlug = workspaceStore.activeWorkspaceSlug;
    const topics = topicPolicy.resolveAllowedTopics({
      permissions: workspaceStore.permissions,
      surface: "app"
    });

    return {
      eligible: Boolean(isSignedIn && workspaceSlug && topics.length > 0),
      fingerprint: `app:${isSignedIn ? 1 : 0}:${workspaceSlug}:${topics.join(",")}`,
      subscribePayload: {
        workspaceSlug,
        topics
      }
    };
  },
  isEventDeferred: (eventEnvelope) => {
    const commandId = String(eventEnvelope?.commandId || "").trim();
    if (!commandId) {
      return false;
    }

    return commandTracker.getCommandState(commandId) === "pending";
  },
  onEvent: async (eventEnvelope, context) => {
    await appRealtimeHandlers.processEvent(eventEnvelope, context);
  },
  onSubscribed: async ({ subscribePayload }) => {
    await appRealtimeHandlers.reconcileTopics(subscribePayload);
  },
  onConnectionStateChange: ({ state }) => {
    uiStore.realtimeState = state;
  },
  transport: createSocketIoTransport({
    path: "/api/realtime"
  })
});

runtime.start();
```

What this gives you in real terms:

1. Predictable reconnect behavior.
2. Fewer race-condition bugs between API writes and realtime fanout.
3. Strict separation between reusable mechanics and app policy.

---

## 11) Troubleshooting For Beginners

1. **Runtime never connects**
Likely causes:
1. `resolveEligibility().eligible` is `false`.
2. `buildRealtimeUrl` returns empty string.
3. custom transport failed validation.
What to check:
1. log eligibility object each interval.
2. add `onConnectionStateChange` logging.

2. **Subscribe ack ignored**
Likely cause:
1. ack payload does not match `subscribePayload`.
What to check:
1. compare outgoing subscribe message and incoming ack.
2. custom `isSubscribeAckMatch` logic.

3. **Self-events processed too early**
Likely cause:
1. `isEventDeferred` is missing or returns `false` for pending command.
What to check:
1. verify command IDs are included in write request and event envelope.

4. **Memory grows in long-lived tabs**
Likely cause:
1. limits too high for workload.
What to check:
1. tune tracker caps and replay policy.
2. ensure `stop()` is called on teardown.

---

## 12) Common Mistakes

1. Putting topic names or permission policy into this package.
Keep those in app code.

2. Returning unstable `fingerprint` values.
Use deterministic fields only.

3. Forgetting to mark command success/failure in API layer.
Then deferred replay cannot behave correctly.

4. Doing cache invalidation inside shared package.
Do it in app `onEvent` handler.

5. Ignoring `stop()` on app teardown/sign-out.
This can leave stale listeners/timers alive.
