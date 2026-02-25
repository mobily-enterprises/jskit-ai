# Realtime Subsystem Completion TODO

This document captures what is still missing to call realtime "complete" for this app, plus concrete ways to close each gap.

## Goal

Make UI state changes reliable across tabs/sessions/surfaces with clear authorization, correlation, and operational behavior.

## 1) Fix chat surface policy mismatch

### Evidence

`shared/topicRegistry.js` restricts chat topics to `app`:

```js
[REALTIME_TOPICS.CHAT]: {
  subscribeSurfaces: ["app"],
  requiredAnyPermission: ["chat.read"]
},
[REALTIME_TOPICS.TYPING]: {
  subscribeSurfaces: ["app"],
  requiredAnyPermission: ["chat.read"]
}
```

`src/app/router/routes/chatRoutes.js` redirects non-admin chat routes into admin chat:

```js
if (normalizedSurface !== "admin") {
  throw redirect({ to: adminWorkspaceChatRoutePath, ... });
}
```

### Why this is incomplete

Chat UI and realtime policy disagree on which surface is valid, which causes confusing/partial delivery expectations.

### How to fix it

Pick one model and enforce it everywhere:

1. `Admin chat model`:
 - Allow `chat` + `typing` subscriptions on `admin` in `shared/topicRegistry.js`.
 - Keep route redirect behavior as-is.
2. `App chat model`:
 - Keep topic policy as-is.
 - Remove redirect to admin chat and keep chat UI on app surface.

### Definition of done

1. Route surface and topic surface rules match.
2. Subscription tests pass for the selected surface.
3. Manual check: sending chat message in one tab updates another tab on same surface.

## 2) Ensure publish parity across channels (api, assistant_tool, internal)

### Evidence

HTTP projects controller publishes realtime:

```js
publishProjectEventForRequest({
  request,
  workspace: request.workspace,
  project: response?.project,
  operation: "created"
});
```

Projects contributor supports multiple channels but does not publish itself:

```js
channels: ["api", "assistant_tool", "internal"],
async execute(input, context) {
  return resolvedProjectsService.create(...);
}
```

### Why this is incomplete

Behavior differs by execution path. API-triggered actions fan out; assistant/internal-triggered actions may not.

### How to fix it

Move publish responsibility to a shared action/service layer so all channels use identical mutation side effects:

1. Publish inside action contributor or module service, not only controller wrappers.
2. Pass `commandId`, `sourceClientId`, `actorUserId` from `context.requestMeta` when present.
3. Keep controller-level publish only as temporary fallback, then remove after parity is verified.

### Definition of done

1. Same mutation produces same realtime envelope regardless of channel.
2. Tests cover api + assistant_tool for create/update flows.
3. No duplicate publish for a single command.

## 3) Expand command-correlation route coverage

### Evidence

`DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES` currently includes some write routes, for example:

```js
{ method: "POST", pattern: /^\/api\/v1\/chat\/threads\/[^/]+\/typing$/ }
```

But notable write routes are missing from this list, such as:

1. `POST /api/v1/chat/threads/:threadId/reactions`
2. `DELETE /api/v1/chat/threads/:threadId/reactions`
3. `POST /api/v1/workspace/invitations/redeem`

### Why this is incomplete

Self-event dedupe and deferred replay depend on command correlation headers. Missing routes can create inconsistent UX for local-vs-remote updates.

### How to fix it

1. Add missing write endpoints to `DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES`.
2. Add route coverage tests in `tests/client/api.vitest.js` asserting:
 - correlated writes include `x-command-id` + `x-client-id`
 - reads do not
3. Add a guardrail test that compares known event-publishing write routes against correlation patterns.

### Definition of done

1. Every event-producing write route is correlated.
2. Correlation tests fail if a new write route is added without coverage.

## 4) Re-check authorization for targeted chat fanout

### Evidence

Targeted events are emitted directly to user rooms:

```js
if (targetUserIds.length > 0) {
  await fanoutTargetedEvent(eventEnvelope, targetUserIds);
  return;
}
```

And targeted envelope shape omits workspace slug:

```js
return {
  ...,
  scopeKind,
  workspaceId,
  targetUserIds,
  ...
};
```

### Why this is incomplete

Broadcast workspace events use per-socket re-authorization (`canSocketReceiveEvent`), targeted events currently do not. For workspace-scoped targeted events, this is weaker policy enforcement.

### How to fix it

1. Include enough workspace context in targeted workspace events (`workspaceSlug`, optionally `topic` override if needed).
2. For `scopeKind: "workspace"` targeted events, run `canSocketReceiveEvent` before `emitEventMessage`.
3. Evict stale subscriptions where appropriate, matching broadcast behavior.
4. Keep global DM (`scopeKind: "global"`) behavior lightweight and user-targeted.

### Definition of done

1. Targeted workspace chat event delivery is permission-checked per socket.
2. Revoked permissions stop targeted workspace deliveries without reconnect.

## 5) Close feature coverage gaps (beyond current topics)

### Evidence

Current topic set is limited to:

```js
const REALTIME_TOPICS = {
  PROJECTS,
  WORKSPACE_META,
  WORKSPACE_SETTINGS,
  WORKSPACE_MEMBERS,
  WORKSPACE_INVITES,
  WORKSPACE_AI_TRANSCRIPTS,
  WORKSPACE_BILLING_LIMITS,
  CHAT,
  TYPING
};
```

Example mutable settings controller path without realtime publish:

```js
async function updateProfile(request, reply) {
  const result = await executeAction(...);
  reply.code(200).send(result.settings);
}
```

### Why this is incomplete

If requirement is "pretty much any UI mutation shows in other tab," many domains are still refresh-only.

### How to fix it

Create a domain coverage plan and implement in priority order:

1. Add new topics/event types in `shared/eventTypes.js`.
2. Add policy rules in `shared/topicRegistry.js`.
3. Publish events in mutation paths.
4. Add client invalidation strategy in `src/platform/realtime/realtimeEventHandlers.js`.
5. Add tests for route + publish + client invalidation.

Suggested first domains:

1. User settings/profile/chat prefs/security session actions.
2. Console admin mutations (if cross-tab consistency is required there).

### Definition of done

1. Domain matrix exists: each write endpoint mapped to `realtime: yes/no + reason`.
2. Required domains show cross-tab updates with no manual refresh.

## 6) Clarify assistant realtime expectations

### Evidence

Assistant UI runtime is stream-based:

```js
const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname,
  ...
});
```

Transcript realtime topic is admin-only:

```js
[REALTIME_TOPICS.WORKSPACE_AI_TRANSCRIPTS]: {
  subscribeSurfaces: ["admin"],
  requiredAnyPermission: ["workspace.ai.transcripts.read"]
}
```

### Why this is incomplete

If desired behavior is "active assistant stream appears live in other tabs," current architecture does not do that by websocket event stream.

### How to fix it

Pick and implement one explicit contract:

1. `Transcript-sync only`:
 - Keep stream local.
 - Use transcript update events to refresh history/list views.
2. `Live mirror`:
 - Add assistant live topic/events for deltas/tool events.
 - Publish stream chunks/events to websocket for eligible subscribers.
 - Add ordering/idempotency handling for chunked events.

### Definition of done

1. Product contract documented ("transcript-sync" or "live mirror").
2. Tests assert expected cross-tab assistant behavior.

## 7) Add durability/replay guarantees (or codify non-goals)

### Evidence

Realtime bus is in-process:

```js
const realtimeEventsBus = createRealtimeEventsBus();
realtimeEventsBus.publish(envelope);
```

### Why this is incomplete

Events are best-effort while connected. There is no durable backlog replay for disconnect windows.

### How to fix it

Choose target reliability level:

1. `Best-effort + refresh fallback`:
 - Keep current architecture.
 - Explicitly document guarantees and enforce reconnect invalidation behavior.
2. `Durable replay`:
 - Persist events (outbox/stream).
 - Track per-client cursor/offset.
 - On reconnect, replay missed events before live subscription.

### Definition of done

1. Reliability guarantee documented in architecture docs.
2. Integration tests cover disconnect/reconnect data consistency for selected guarantee.

## 8) Improve operational observability and UX state

### Evidence

Client connection state logging is development-only:

```js
if (import.meta?.env?.MODE !== "development") return;
console.debug("[realtime-runtime]", summary, state);
```

### Why this is incomplete

Production diagnosis and user-facing health status are limited.

### How to fix it

1. Add realtime metrics:
 - subscribe success/error counts
 - reconnect attempts
 - fanout failures
 - auth evictions
2. Add structured logs with request/socket identifiers.
3. Add optional UI connectivity indicator for degraded/offline websocket state.

### Definition of done

1. Dashboards/alerts exist for key realtime failure modes.
2. Support can answer "is realtime healthy?" quickly from telemetry.

## 9) Suggested implementation order

1. Surface/policy alignment for chat.
2. Publish parity across channels.
3. Command-correlation route coverage.
4. Targeted fanout authorization re-check.
5. Remaining domain coverage expansion.
6. Assistant behavior contract (transcript-sync vs live mirror).
7. Durability and observability hardening.

## 10) Global acceptance checklist

1. Mutation parity: same mutation emits same envelope across all channels.
2. Authorization parity: every delivered event passes current permission/surface checks.
3. Correlation parity: all event-producing writes carry command headers.
4. Coverage parity: required UI domains update across tabs without manual refresh.
5. Recovery parity: reconnect behavior matches documented reliability contract.
6. Ops parity: realtime health is measurable in production.

Assuming two tabs open for the same user/workspace, the main UX sync misses right now are:

  1. Profile/settings/security changes do not live-sync across tabs.
     Examples: avatar, preferences, notifications, chat prefs, password-method toggles, “logout other sessions”
     effects on settings UI.
  2. Assistant chat does not live-sync across tabs.
     If you send a prompt in Tab A, Tab B’s assistant conversation/messages won’t update in realtime (it’s stream-
     local, not websocket-shared).
  3. Project mutations done via assistant-tool/internal action paths may not fan out.
     HTTP project create/update does publish realtime, but non-HTTP channels can bypass that publish step, so other
     tabs can stay stale.
  4. Console-domain mutations are largely refresh-based.
     Console admin/billing/error-management surfaces don’t currently have the same websocket invalidation plumbing
     as workspace/projects/chat.
  5. History/deg2rad activity is refresh-based.
     New calculations/history entries in one tab won’t auto-appear in another tab.





Complete TODO (Total Realtime Fix)

  Phase 0: Lock Product Contract

  1. [ ] Define exact cross-tab sync scope per surface (app, admin, console) in [docs/realtime/requirements.md](/
     home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/realtime/requirements.md).
  2. [ ] Decide assistant mode: transcript-sync only vs live mirror.
  3. [ ] Decide reliability target: best-effort vs durable replay.
  4. [ ] Decide chat surface model: admin-only vs app+admin.

  Phase 1: Build Coverage Matrix

  1. [ ] Audit all write endpoints and actions, then map mutation -> realtime event/topic -> client invalidation.
  2. [ ] Save matrix as [docs/realtime/coverage-matrix.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-
     app/docs/realtime/coverage-matrix.md).
  3. [ ] Mark every currently missing UX sync explicitly (settings/profile/security/console/history/assistant/etc).

  Phase 2: Fix Topic/Surface Policy

  1. [ ] Align chat routing and policy between [chatRoutes.js](/home/merc/Development/current/jskit-ai/apps/jskit-
     value-app/src/app/router/routes/chatRoutes.js) and [topicRegistry.js](/home/merc/Development/current/jskit-ai/
     apps/jskit-value-app/shared/topicRegistry.js).
  2. [ ] Expand [eventTypes.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/eventTypes.js)
     with missing domains: settings/profile/security, console mutations, history updates, assistant live (if
     selected).
  3. [ ] Expand [topicRegistry.js](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/shared/
     topicRegistry.js) with surface and permission rules for every new topic.

  Phase 3: Enforce Publish Parity (All Channels)

  1. [ ] Move mutation publish logic from HTTP-only controllers into shared action/service layer.
  2. [ ] Ensure parity for api, assistant_tool, and internal channels in contributors under [server/runtime/actions/
     contributors](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/
     contributors).
  3. [ ] Ensure projects publish parity between [projects/controller.js](/home/merc/Development/current/jskit-ai/
     apps/jskit-value-app/server/modules/projects/controller.js) and [projects.contributor.js](/home/merc/
     Development/current/jskit-ai/apps/jskit-value-app/server/runtime/actions/contributors/projects.contributor.js).
  4. [ ] Add/verify publishers for settings and other missing mutation domains.

  Phase 4: Command Correlation Completeness

  1. [ ] Add all event-producing write routes to [transportRuntime.js](/home/merc/Development/current/jskit-ai/
     packages/web/web-runtime-core/src/transportRuntime.js) DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES.
  2. [ ] Include currently missing routes (chat reactions, invitation redeem, settings writes, console writes that
     publish events).
  3. [ ] Add guardrail test to fail when an event-producing route lacks correlation headers.

  Phase 5: Targeted Fanout Authorization Hardening

  1. [ ] Include workspaceSlug for workspace-scoped targeted envelopes in [realtimeEvents.js](/home/merc/
     Development/current/jskit-ai/packages/runtime/server-runtime-core/src/realtimeEvents.js).
  2. [ ] Run canSocketReceiveEvent for targeted workspace events in [registerRealtimeServerSocketio.js](/home/merc/
     Development/current/jskit-ai/packages/realtime/realtime-server-socketio/src/registerRealtimeServerSocketio.js).
  3. [ ] Evict stale subscriptions for targeted workspace deliveries same as broadcast flow.

  Phase 6: Client Invalidation Coverage

  1. [ ] Add topic strategies for all new topics in [realtimeEventHandlers.js](/home/merc/Development/current/jskit-
     ai/apps/jskit-value-app/src/platform/realtime/realtimeEventHandlers.js).
  2. [ ] Wire query keys for each affected domain module (settings, console, history, assistant, etc).
  3. [ ] Ensure no-op topics are intentional and documented.

  Phase 7: Assistant Cross-Tab Completion

  1. [ ] If live mirror: add assistant live topics/events, publish streaming chunks, and consume them in [assistant
     runtime](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/src/modules/assistant/runtime.js).
  2. [ ] If transcript-sync: ensure app/admin transcript updates invalidate all relevant assistant views.
  3. [ ] Add dedupe/order guarantees via eventId + commandId for assistant events.

  Phase 8: Durability and Replay

  1. [ ] Implement durable event path (outbox/stream) if “total” reliability is required.
  2. [ ] Add reconnect replay cursor strategy per client/workspace/topic.
  3. [ ] If staying best-effort, explicitly force full revalidation on reconnect and document limitation.

  Phase 9: UX and Operability

  1. [ ] Add realtime connection health indicator in app shells.
  2. [ ] Add observability metrics for subscribe errors, reconnect loops, fanout failures, authorization evictions.
  3. [ ] Add SLO/runbook docs and alert thresholds.

  Phase 10: Test Completion

  1. [ ] Add cross-tab integration tests for each mutation domain in scope.
  2. [ ] Add channel-parity tests (api vs assistant_tool vs internal).
  3. [ ] Add correlation header coverage tests for all publish-producing writes.
  4. [ ] Add targeted authorization regression tests.
  5. [ ] Add reconnect/replay consistency tests.

  Phase 11: Required Docs Updates (docs/)

  1. [ ] Update [docs/flows/07.realtime.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/
     flows/07.realtime.md) with final protocol, topics, auth, and replay semantics.
  2. [ ] Update [docs/flows/01.endpoint-a-to-z.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/
     docs/flows/01.endpoint-a-to-z.md) with “mutation must publish” rule and channel parity.
  3. [ ] Update [docs/architecture/client-boundaries.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-
     app/docs/architecture/client-boundaries.md) with new topic ownership and invalidation boundaries.
  4. [ ] Add [docs/realtime/contracts.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/
     realtime/contracts.md) for event envelope shapes and required fields.
  5. [ ] Add [docs/realtime/coverage-matrix.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/
     realtime/coverage-matrix.md) listing every write flow and sync behavior.
  6. [ ] Add [docs/realtime/operations.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/
     realtime/operations.md) for dashboards, alerts, and troubleshooting.
  7. [ ] Update [docs/README.md](/home/merc/Development/current/jskit-ai/apps/jskit-value-app/docs/README.md) index
     to include new realtime docs.

  Final Definition of Done

  1. [ ] Every mutation in scope has deterministic cross-tab behavior documented and tested.
  2. [ ] No channel-specific sync gaps remain.
  3. [ ] Authorization is enforced uniformly for broadcast and targeted fanout.
  4. [ ] Correlation + dedupe works for all event-producing writes.
  5. [ ] Reconnect behavior matches documented reliability contract.
  6. [ ] Docs and runbooks are current and complete.



