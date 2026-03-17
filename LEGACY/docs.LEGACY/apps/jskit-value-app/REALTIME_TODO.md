# Realtime Subsystem Audit + Completion TODO

Current as of: 2026-02-25

Checked against:
- Latest commits: `44fb9a0`, `44c3377`, `fe2d24d`, `9904857`
- Current working tree (including uncommitted changes in this branch)

## 1) Current Coverage Snapshot

### 1.1 Realtime primitives that are in place

The app has a real websocket/runtime stack and topic registry, including the new alerts topic.

```js
// shared/eventTypes.js
const REALTIME_TOPICS = Object.freeze({
  ALERTS: "alerts",
  PROJECTS: "projects",
  WORKSPACE_META: "workspace_meta",
  WORKSPACE_SETTINGS: "workspace_settings",
  WORKSPACE_MEMBERS: "workspace_members",
  WORKSPACE_INVITES: "workspace_invites",
  WORKSPACE_AI_TRANSCRIPTS: "workspace_ai_transcripts",
  WORKSPACE_BILLING_LIMITS: "workspace_billing_limits",
  CHAT: "chat",
  TYPING: "typing"
});
```

Alerts is now registered as a realtime topic for all surfaces.

```js
// shared/topicRegistry.js
[REALTIME_TOPICS.ALERTS]: {
  subscribeSurfaces: ["app", "admin", "console"],
  requiredAnyPermission: []
}
```

Alerts service publishes targeted realtime events.

```js
// server/modules/alerts/service.js
return {
  eventType: REALTIME_EVENT_TYPES.USER_ALERT_CREATED,
  topic: REALTIME_TOPICS.ALERTS,
  ...,
  targetUserIds: [userId]
};
```

Alerts client store listens to the realtime event bus and refreshes immediately.

```js
// src/app/state/alertsStore.js
realtimeAlertsUnsubscribe = subscribeRealtimeEvents((event) => {
  if (!shouldRefreshFromRealtimeEvent(event)) return;
  void store.refreshPreview({ silent: true, broadcast: true });
});
```

### 1.2 What syncs now (UX-level)

| UX change | Current sync status | Notes |
| --- | --- | --- |
| Create/update project from Projects UI (HTTP API path) | Works cross-tab | Projects controller publishes realtime after action success. |
| Create/update project via assistant tool/internal action channel | Missing | `projects.contributor` handles channels `api/assistant_tool/internal` but does not publish realtime itself. |
| Workspace admin mutations (settings/members/invites) | Works cross-tab | Workspace adapter controller publishes workspace topic events. |
| Chat messages/read/typing/attachments | Works in practice | Delivered via targeted user-room fanout. Important authorization hardening gap remains (below). |
| Alerts created (workspace/console invites, etc.) | Works | Targeted alerts events + alerts store listener. |
| Alerts mark-all-read | Partial | Same-browser tabs sync immediately (BroadcastChannel/localStorage); other sessions rely on polling refresh. |
| Assistant chat stream (live turn deltas/tool events) | Missing | Stream is local tab runtime; not mirrored over websocket to other tabs. |
| Assistant transcript list updates in admin transcript views | Partial | Workspace transcript topic exists, but assistant chat UI does not consume that query key family. |
| Settings/profile/security mutations | Missing | No realtime publish + no topic strategy for these domains. |
| Console members/invites/billing/errors mutations | Missing | Console domain is mostly refresh/local invalidation only; no console realtime topics/events. |
| Deg2rad/history writes | Missing | No realtime publish for history/deg2rad action flows. |

## 2) Critical Gaps To Fix (Total List)

This is the total fix list, not only UX polish.

### 2.1 Fix user-scoped subscribe contract (console + alerts)

Evidence:

```js
// src/platform/realtime/realtimeRuntime.js
const canConnectWithoutWorkspace = hasUserScopedTopic(topics);
eligible: Boolean(authenticated && topics.length > 0 && (workspaceSlug || canConnectWithoutWorkspace))
```

```js
// packages/realtime/realtime-server-socketio/src/registerRealtimeServerSocketio.js
if (!workspaceSlug) {
  emitProtocolError(socket, { code: REALTIME_ERROR_CODES.WORKSPACE_REQUIRED });
  return;
}
```

Why this matters:
- Client now intentionally allows workspace-less console realtime for user-scoped topics.
- Server still hard-requires `workspaceSlug` on subscribe.

How to fix:
1. Add topic-level scope metadata (for example `requiresWorkspace: false` for `alerts`).
2. In server subscribe flow, require workspace only for topics that need workspace scope.
3. Add tests for successful console subscribe with empty `workspaceSlug` on `alerts`.

Definition of done:
1. Console subscribe to `alerts` returns `subscribed` ack (no `workspace_required`).
2. Existing workspace-scoped topics still enforce workspace slug.

### 2.2 Enforce authorization for targeted fanout

Evidence:

```js
// packages/realtime/realtime-server-socketio/src/registerRealtimeServerSocketio.js
if (targetUserIds.length > 0) {
  await fanoutTargetedEvent(eventEnvelope, targetUserIds);
  return;
}
```

```js
// fanoutTargetedEvent currently emits directly
await Promise.all(
  Array.from(socketById.values()).map(async (socket) => {
    await emitEventMessage(socket, eventEnvelope);
  })
);
```

```js
// packages/runtime/server-runtime-core/src/realtimeEvents.js
function createTargetedChatEventEnvelope({ ..., workspaceId, ... }) {
  return {
    ...,
    scopeKind,
    workspaceId,
    targetUserIds,
    ...
  };
}
```

Why this matters:
- Workspace broadcast path re-checks authorization (`canSocketReceiveEvent`), targeted path does not.
- Targeted workspace events do not carry `workspaceSlug`, making policy re-check harder.

How to fix:
1. Include workspace slug/context in workspace-scoped targeted envelopes.
2. For targeted workspace events, run `canSocketReceiveEvent` per socket before emit.
3. Evict stale subscriptions when authorization fails, same as broadcast path.
4. Keep global DM behavior lightweight, but still enforce minimum topic/surface expectations.

Definition of done:
1. Permission revocation stops targeted workspace event delivery without reconnect.
2. Targeted fanout tests cover allow/deny/evict behavior.

### 2.3 Align chat surface policy with routing

Evidence:

```js
// shared/topicRegistry.js
[REALTIME_TOPICS.CHAT]: { subscribeSurfaces: ["app"], requiredAnyPermission: ["chat.read"] }
[REALTIME_TOPICS.TYPING]: { subscribeSurfaces: ["app"], requiredAnyPermission: ["chat.read"] }
```

```js
// src/app/router/routes/chatRoutes.js
if (normalizedSurface !== "admin") {
  throw redirect({ to: adminWorkspaceChatRoutePath, ... });
}
```

Why this matters:
- Route policy says chat UI is admin-first.
- Topic policy says chat subscriptions are app-only.
- Current behavior “works” mostly because targeted fanout bypasses subscribe policy checks.

How to fix:
1. Pick one model explicitly: admin-only chat, app-only chat, or both.
2. Update topic registry subscribe surfaces accordingly.
3. Update tests for route guard + subscribe authorization to match chosen model.

Definition of done:
1. Route behavior and topic policy no longer conflict.

### 2.4 Move project publish to channel-neutral action/service layer

Evidence:

```js
// server/modules/projects/controller.js
publishProjectEventForRequest({ request, workspace: request.workspace, project: response?.project, operation: "created" });
```

```js
// server/runtime/actions/contributors/projects.contributor.js
channels: ["api", "assistant_tool", "internal"],
async execute(input, context) {
  return resolvedProjectsService.create(...);
}
```

Why this matters:
- API controller path publishes.
- Assistant/internal action path can mutate without publishing.

How to fix:
1. Publish from shared action/service layer (not only HTTP controller).
2. Pass through `commandId`, `sourceClientId`, and actor metadata from action context.
3. Remove duplicate controller-level publish once parity is verified.

Definition of done:
1. Same mutation emits same realtime event regardless of channel.

### 2.5 Complete command-correlation coverage for all event-producing writes

Evidence:

```js
// packages/web/web-runtime-core/src/transportRuntime.js
const DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES = [
  ...,
  { method: "POST", pattern: /^\/api\/chat\/threads\/[^/]+\/typing$/ }
];
```

Missing examples:
- `POST /api/chat/threads/:threadId/reactions`
- `DELETE /api/chat/threads/:threadId/reactions`
- `POST /api/workspace/invitations/redeem`

How to fix:
1. Add missing patterns to correlated write route list.
2. Update tests that currently assert no command headers for invitation redeem.
3. Add guardrail test that fails if a publishing write route lacks correlation headers.

Definition of done:
1. Every event-producing write carries stable `x-command-id` + `x-client-id`.

### 2.6 Add explicit alerts strategy in realtime event handler registry

Evidence:

```js
// src/platform/realtime/realtimeEventHandlers.js
const TOPIC_STRATEGY_REGISTRY = {
  projects: ...,
  workspace_settings: ...,
  ...,
  typing: ...
};
```

`alerts` is currently not listed, but event bus publish happens before strategy lookup.

```js
publishRealtimeEvent(normalizedEvent);
const topicStrategy = resolveTopicStrategy(normalizedEvent.topic);
if (!topicStrategy) return { status: "ignored_topic" };
```

Why this matters:
- Alerts depends on implicit ordering side-effect, not explicit strategy.

How to fix:
1. Add explicit `ALERTS` topic strategy (no-op invalidation is fine if intentional).
2. Keep `publishRealtimeEvent` behavior explicit and documented.

Definition of done:
1. Alerts topic is represented intentionally in registry/tests.

### 2.7 Fill missing domain coverage for “any UI change syncs” requirement

Domains currently missing realtime publication + invalidation:
- settings/profile/security
- deg2rad/history
- console admin/billing/errors domain updates

How to fix:
1. Add topic + event types in `shared/eventTypes.js`.
2. Add policy in `shared/topicRegistry.js`.
3. Publish in mutation paths.
4. Add query invalidation strategy in `src/platform/realtime/realtimeEventHandlers.js`.
5. Add tests for end-to-end mutation -> event -> other-tab refresh.

Definition of done:
1. Coverage matrix exists and every required mutation is marked synced or intentionally not synced.

### 2.8 Define and implement assistant cross-tab contract

Current state:

```js
// src/modules/assistant/runtime.js
const assistantRuntime = createAssistantRuntime({ api, useWorkspaceStore, ... });
```

Assistant flow is stream-local. Realtime transcript topic is admin-only policy.

```js
// shared/topicRegistry.js
[REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]: {
  subscribeSurfaces: ["admin"],
  requiredAnyPermission: ["workspace.ai.transcripts.read"]
}
```

How to fix:
1. Choose one contract:
- Transcript-sync only.
- Live mirror of assistant stream events.
2. If transcript-sync only:
- Ensure assistant chat views invalidate the correct assistant query keys from transcript events.
- Expand surface policy if app-surface assistant should sync too.
3. If live mirror:
- Add assistant-live topic/events with ordering/deduping guarantees.

Definition of done:
1. Assistant cross-tab behavior is deterministic, documented, and tested.

### 2.9 Reliability contract: best-effort vs durable replay

Evidence:

```js
// runtime bus is in-process
const realtimeEventsBus = createRealtimeEventsBus();
realtimeEventsBus.publish(envelope);
```

How to fix:
1. Choose reliability target.
2. If best-effort: enforce reconnect invalidation guarantees and document them.
3. If durable replay: add persisted outbox/stream + cursor replay path.

Definition of done:
1. Disconnect/reconnect consistency matches documented guarantee.

### 2.10 Production observability + UX health state

Current state:

```js
// src/platform/realtime/realtimeRuntime.js
if (import.meta?.env?.MODE !== "development") return;
console.debug("[realtime-runtime]", summary, state);
```

How to fix:
1. Add realtime metrics/logs (subscribe errors, reconnect loops, fanout failures, auth evictions).
2. Add app-visible websocket health indicator.
3. Add alerting/runbook thresholds.

Definition of done:
1. Realtime health is measurable in production without devtools.

## 3) Test Work Required

- [ ] Add server tests for workspace-less user-scoped subscribe (`alerts` on `console`).
- [ ] Add server tests for targeted fanout authorization re-check and eviction.
- [ ] Add parity tests for project action channel publish (`api`, `assistant_tool`, `internal`).
- [ ] Add command-correlation tests for reaction routes + invitation redeem.
- [ ] Add integration tests for missing domain sync as each domain is added.
- [ ] Add reconnect consistency tests for chosen reliability model.

## 4) Docs TODO (`docs/`)

- [ ] Update `docs/flows/07.realtime.md` to include `alerts`, targeted auth semantics, and user-scoped subscribe rules.
- [ ] Update `docs/flows/08.chat-message.md` with final chat surface policy and targeted auth behavior.
- [ ] Update `docs/flows/10.assistant-tools.md` with explicit assistant cross-tab contract.
- [ ] Update `docs/flows/01.endpoint-a-to-z.md` with channel-neutral publish requirement + correlation guardrail.
- [ ] Update `docs/architecture/workspace-and-surfaces.md` for console/user-scoped realtime behavior.
- [ ] Add `docs/realtime/contracts.md` for envelope fields required per scope type.
- [ ] Add `docs/realtime/coverage-matrix.md` mapping every mutation endpoint/action to realtime behavior.
- [ ] Add `docs/realtime/operations.md` for metrics, alerts, and troubleshooting.
- [ ] Update `docs/README.md` index to include new realtime docs.

## 5) Final Completion Criteria

- [ ] No channel-specific publish gaps remain.
- [ ] Targeted and broadcast fanout both enforce authorization consistently.
- [ ] Correlation headers cover every event-producing write.
- [ ] Required UX domains sync across tabs/sessions as documented.
- [ ] Reliability behavior matches the chosen contract.
- [ ] Realtime docs and tests are current and enforceable.
