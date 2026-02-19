Perfect. Here is the same flow, but with actual code.

1. **Form submit starts the whole path** (`src/views/workspace-settings/WorkspaceSettingsView.vue:14`, `src/views/workspace-settings/WorkspaceSettingsView.vue:120`)
```vue
<v-form @submit.prevent="submitWorkspaceSettings" novalidate>
...
<v-btn type="submit" color="primary" :loading="isSavingWorkspaceSettings">
  Save workspace settings
</v-btn>
```
When: on click submit.  
Why: prevents default browser submit and runs Vue action.

2. **Client action builds payload and calls mutation** (`src/views/workspace-settings/useWorkspaceSettingsView.js:334`)
```js
async function submitWorkspaceSettings() {
  const data = await updateWorkspaceSettingsMutation.mutateAsync({
    name: workspaceForm.name,
    color: workspaceForm.color,
    avatarUrl: workspaceForm.avatarUrl,
    invitesEnabled: workspaceForm.invitesEnabled,
    appDenyEmails: parseDenyEmailsInput(workspaceForm.appDenyEmailsText),
    defaultMode: workspaceForm.defaultMode,
    defaultTiming: workspaceForm.defaultTiming,
    defaultPaymentsPerYear: Number(workspaceForm.defaultPaymentsPerYear),
    defaultHistoryPageSize: Number(workspaceForm.defaultHistoryPageSize)
  });

  queryClient.setQueryData(settingsQueryKey, data);
  applyWorkspaceSettingsData(data);
  await workspaceStore.refreshBootstrap();
}
```
When: immediately after submit.  
Why: optimistic UI + authoritative bootstrap refresh.

3. **Mutation calls workspace API wrapper** (`src/services/api/workspaceApi.js:21`)
```js
updateSettings(payload) {
  return request("/api/workspace/settings", { method: "PATCH", body: payload });
}
```

4. **Transport attaches context + correlation + CSRF** (`src/services/api/transport.js:249`, `src/services/api/transport.js:23`, `src/services/api/transport.js:195`)
```js
const REALTIME_CORRELATED_WRITE_ROUTES = [
  { method: "PATCH", pattern: /^\/api\/workspace\/settings$/ },
  ...
];

function buildCommandContext(url, method, headers, existingCommandContext) {
  if (!isRealtimeCorrelatedCommandRequest(url, method)) return null;
  const commandId = String(headers["x-command-id"] || "").trim() || generateCommandId();
  const clientId = String(headers["x-client-id"] || "").trim() || getClientId();
  headers["x-command-id"] = commandId;
  headers["x-client-id"] = clientId;
  commandTracker.markCommandPending(commandId, { method, url });
  return { commandId, clientId, tracked: true, finalized: false };
}
```
When: before `fetch`.  
Why: enables self-event race handling and consistent command identity across retries.

5. **Server route requires auth/workspace/admin/permission** (`server/modules/workspace/routes/admin.route.js:22`)
```js
{
  path: "/api/workspace/settings",
  method: "PATCH",
  auth: "required",
  workspacePolicy: "required",
  workspaceSurface: "admin",
  permission: "workspace.settings.update",
  handler: controllers.workspace?.updateWorkspaceSettings
}
```

6. **Auth preHandler enforces CSRF/auth/workspace context/permission** (`server/fastify/auth.plugin.js:93`, `server/fastify/auth.plugin.js:157`)
```js
if (csrfProtectionEnabled && UNSAFE_METHODS.has(request.method)) {
  await enforceCsrfProtection(request, reply);
}

const authResult = await authService.authenticateRequest(request);
...
const context = await workspaceService.resolveRequestContext({
  user: request.user,
  request,
  workspacePolicy,
  workspaceSurface
});
request.workspace = context.workspace;
request.permissions = Array.isArray(context.permissions) ? context.permissions : [];

if (permission && !hasPermission(request.permissions, permission)) {
  throw new AppError(403, "Forbidden.");
}
```

7. **Controller executes write, then publishes realtime events** (`server/modules/workspace/controller.js:120`)
```js
async function updateWorkspaceSettings(request, reply) {
  const response = await workspaceAdminService.updateWorkspaceSettings(request.workspace, request.body || {});

  publishWorkspaceEventSafely({
    request,
    topic: REALTIME_TOPICS.WORKSPACE_SETTINGS,
    eventType: REALTIME_EVENT_TYPES.WORKSPACE_SETTINGS_UPDATED,
    entityType: "workspace",
    entityId: request.workspace?.id,
    payload: { operation: "updated", workspaceId: parsePositiveInteger(request.workspace?.id) }
  });

  publishWorkspaceEventSafely({
    request,
    topic: REALTIME_TOPICS.WORKSPACE_META,
    eventType: REALTIME_EVENT_TYPES.WORKSPACE_META_UPDATED,
    entityType: "workspace",
    entityId: request.workspace?.id,
    payload: { operation: "updated", workspaceId: parsePositiveInteger(request.workspace?.id) }
  });

  reply.code(200).send(response);
}
```
Why two events: one admin-settings topic, one app-facing meta topic.

8. **Domain service validates + writes** (`server/domain/workspace/services/admin.service.js:136`)
```js
const parsed = parseWorkspaceSettingsPatch(payload);
if (Object.keys(parsed.fieldErrors).length > 0) {
  throw new AppError(400, "Validation failed.", { details: { fieldErrors: parsed.fieldErrors } });
}

await runInAdminTransaction(async (trx) => {
  if (Object.keys(parsed.workspacePatch).length > 0) {
    await workspacesRepository.updateById(workspace.id, parsed.workspacePatch, { trx });
  }
  ...
  if (Object.keys(settingsPatch).length > 0) {
    await workspaceSettingsRepository.updateByWorkspaceId(workspace.id, settingsPatch, { trx });
  }
});
```

9. **Color is explicitly parsed/validated** (`server/domain/workspace/policies/workspaceSettingsPatch.js:143`)
```js
if (Object.prototype.hasOwnProperty.call(body, "color")) {
  workspacePatch.color = normalizeWorkspaceColor(body.color);
}
```

10. **Workspace row update persists color** (`server/domain/workspace/repositories/workspaces.repository.js:109`)
```js
if (Object.prototype.hasOwnProperty.call(patch, "color")) {
  dbPatch.color = coerceWorkspaceColor(patch.color);
}
await client("workspaces").where({ id }).update(dbPatch);
```

11. **Realtime event envelope + publish** (`server/domain/realtime/services/events.service.js:104`)
```js
function publishWorkspaceEvent({ eventType, topic, workspace, entityType = "workspace", ... }) {
  const envelope = createEventEnvelope({ eventType, topic, workspace, entityType, ... });
  publish(envelope);
  return envelope;
}
```

12. **WS route fans out to subscribers by `workspaceId:topic`** (`server/fastify/registerRealtimeRoutes.js:484`)
```js
function fanoutEvent(eventEnvelope) {
  const subscriptionKey = buildSubscriptionKey(Number(eventEnvelope.workspaceId), String(eventEnvelope.topic || "").trim());
  const subscribers = subscriptionsByKey.get(subscriptionKey);
  if (!subscribers) return;

  const payload = { type: REALTIME_MESSAGE_TYPES.EVENT, event: eventEnvelope };
  for (const connectionState of [...subscribers]) {
    sendJson(connectionState.socket, payload);
  }
}
```

13. **Other tab runtime receives and routes event** (`src/services/realtime/realtimeRuntime.js:343`)
```js
if (type === REALTIME_MESSAGE_TYPES.EVENT && messagePayload?.event) {
  await eventHandlers.processEvent(messagePayload.event, { allowDeferral: true });
}
```

14. **Handler strategy decides what to refresh** (`src/services/realtime/realtimeEventHandlers.js:68`)
```js
if (topic === REALTIME_TOPICS.WORKSPACE_SETTINGS) {
  return { invalidate: invalidateForWorkspaceAdminEvent, refreshBootstrap: true };
}
if (topic === REALTIME_TOPICS.WORKSPACE_META) {
  return { invalidate: invalidateNoop, refreshBootstrap: true };
}
```
So both settings/meta events trigger bootstrap refresh where configured.

15. **Bootstrap refresh updates active workspace color/name/avatar** (`src/stores/workspaceStore.js:291`, `src/stores/workspaceStore.js:202`)
```js
async refreshBootstrap() {
  const payload = await api.workspace.bootstrap();
  return this.applyBootstrap(payload);
}
...
this.activeWorkspace = normalizeWorkspace(payload.activeWorkspace); // includes color
```

If you want, next I can do the same “again with code” trace specifically for **workspace color only** and show exactly where it can fail per surface/topic/permission.
