# Client-Side Applicability Recheck: `apps/jskit-value-app/src`

## Scope
This report contains only the applicability recheck of the previous client report.  
For each item, it documents:
1. What the code looks like now (package side + app usage).
2. Whether the previous advice is still applicable.
3. What it would look like after applying the advice (when applicable).

---

## 1) Still Applicable

### 1.1 UI Inventory Remains Correct (old `1.1`)

#### Current library code (package side)
There is still no package-provided Vue component library:

```bash
# repo root
rg --files packages -g '*.vue'
# no results
```

#### Current app usage
The visual layer remains app-local Vue SFCs + Vuetify primitives:

```vue
<!-- apps/jskit-value-app/src/shells/app/AppShell.vue -->
<v-app class="bg-background" :style="workspaceThemeStyle">
  ...
  <Outlet />
</v-app>
```

#### Applicability verdict
Still applicable.

#### After applying advice
If shared UI primitives are desired, app usage would move to package components:

```vue
<!-- hypothetical usage -->
<WorkspaceShellLayout
  :workspace-theme-style="workspaceThemeStyle"
  :navigation-items="navigationItems"
  :destination-title="destinationTitle"
  @navigate="goToNavigationItem"
>
  <Outlet />
</WorkspaceShellLayout>
```

---

### 1.2 Supporting Library Inventory Is Still Informative (old `1.2`)

#### Current app usage
The client still uses the listed libraries and package runtimes/contracts:

```js
// apps/jskit-value-app/src/runtime/chatRuntime.js
import { createChatRuntime } from "@jskit-ai/chat-client-runtime";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";

// apps/jskit-value-app/src/services/realtime/commandTracker.js
import { createCommandTracker } from "@jskit-ai/realtime-client-runtime";
```

```js
// apps/jskit-value-app/src/views/login/useLoginView.js
import { AUTH_OAUTH_PROVIDER_METADATA, AUTH_OAUTH_PROVIDERS } from "@jskit-ai/access-core/oauthProviders";
```

#### Applicability verdict
Still applicable as informational inventory.

#### After applying advice
No required change. This section is descriptive, not a remediation item.

---

### 1.3 No Package UI Layer Baseline Remains Correct (old `2.0`)

#### Current app usage
Layout and feature UIs are still local SFCs:
1. `shells/app/AppShell.vue`
2. `shells/admin/AdminShell.vue`
3. `views/chat/ChatView.vue`
4. `views/assistant/AssistantView.vue`
5. settings views/forms in `views/settings/**`

#### Applicability verdict
Still applicable.

#### After applying advice
If centralization is needed, extract high-reuse primitives to a package (`shell`, `composer`, `timeline row`) and keep app policy/state local.

---

### 1.4 Transport Runtime Customization Gap Remains Applicable (old `2.2`)

#### Current library code (package side)
`createTransportRuntime` still supports customization hooks:

```js
// packages/web/web-runtime-core/src/transportRuntime.js
function createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker,
  aiStreamUrl = DEFAULT_AI_STREAM_URL,
  apiPathPrefix = DEFAULT_API_PATH_PREFIX,
  realtimeCorrelatedWriteRoutes = DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES,
  generateCommandId = createCommandIdGenerator()
} = {}) { ... }
```

#### Current app usage
The app still wires transport with defaults:

```js
// apps/jskit-value-app/src/services/api/transport.js
const transportRuntime = createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker
});
```

#### Applicability verdict
Still applicable.

#### After applying advice
Extend correlated routes for chat write endpoints and define explicit command-id policy:

```js
import {
  createTransportRuntime,
  DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES
} from "@jskit-ai/web-runtime-core/transportRuntime";

const transportRuntime = createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker,
  realtimeCorrelatedWriteRoutes: [
    ...DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES,
    { method: "POST", pattern: /^\/api\/chat\/threads\/[^/]+\/messages$/ },
    { method: "POST", pattern: /^\/api\/chat\/threads\/[^/]+\/read$/ },
    { method: "POST", pattern: /^\/api\/chat\/threads\/[^/]+\/typing$/ }
  ],
  generateCommandId() {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `cmd_app_${crypto.randomUUID()}`
      : `cmd_app_${Date.now()}`;
  }
});
```

---

### 1.5 Realtime Tracker/Runtime Tuning Gap Remains Applicable (old `2.3`)

#### Current library code (package side)
The package still exposes policy hooks:

```js
// packages/realtime/realtime-client-runtime/src/commandTracker.js
function createCommandTracker(options = {}) { ... }

// packages/realtime/realtime-client-runtime/src/runtime.js
function createRealtimeRuntime(options = {}) {
  // reconnectPolicy, replayPolicy, maintenanceIntervalMs,
  // onConnectionStateChange, socketPath/transports/query, etc.
}
```

#### Current app usage
App runtime still uses default tracker options and default runtime policy settings:

```js
// apps/jskit-value-app/src/services/realtime/commandTracker.js
const commandTracker = createCommandTracker();
```

```js
// apps/jskit-value-app/src/services/realtime/realtimeRuntime.js
return createRealtimeClientRuntime({
  commandTracker,
  resolveEligibility() { ... },
  onEvent(...) { ... },
  onEvents(...) { ... },
  onSubscribed(...) { ... },
  isSubscribeAckMatch(...) { ... },
  surface: normalizedSurface,
  buildRealtimeUrl,
  transport: createSocketIoTransport({ socketFactory }),
  messageTypes: REALTIME_MESSAGE_TYPES,
  errorCodes: REALTIME_ERROR_CODES
});
```

#### Applicability verdict
Still applicable.

#### After applying advice
Set explicit tracker/runtime policies and connection-state callbacks:

```js
// services/realtime/commandTracker.js
import { createCommandTracker } from "@jskit-ai/realtime-client-runtime";

const commandTracker = createCommandTracker({
  commandTtlMs: 45_000,
  finalizedTtlMs: 120_000,
  maxDeferredEventsPerCommand: 40
});
```

```js
// services/realtime/realtimeRuntime.js
import {
  createRealtimeRuntime as createRealtimeClientRuntime,
  createReconnectPolicy,
  createReplayPolicy,
  createSocketIoTransport
} from "@jskit-ai/realtime-client-runtime";

return createRealtimeClientRuntime({
  ...existingOptions,
  reconnectPolicy: createReconnectPolicy({ baseDelayMs: 800, maxDelayMs: 20_000 }),
  replayPolicy: createReplayPolicy({ maxEventsPerCommand: 40, maxEventsPerTick: 120 }),
  maintenanceIntervalMs: 1500,
  onConnectionStateChange(state) {
    // metrics/logging hook
  },
  transport: createSocketIoTransport({
    socketFactory,
    path: "/api/realtime",
    transports: ["websocket"]
  })
});
```

---

### 1.6 Settings Model Extension Gap Remains Applicable (old `2.6`)

#### Current library code (package side)
The package still supports extension via `createSettingsModel`:

```js
// packages/workspace/workspace-console-core/src/settingsModel.js
function createSettingsModel({ avatar = {}, modelExtension = {} } = {}) { ... }
```

#### Current app usage
The app still consumes static defaults/options directly:

```js
// apps/jskit-value-app/src/views/settings/preferences/lib/settingsPreferencesOptions.js
import { SETTINGS_PREFERENCES_OPTIONS } from "@jskit-ai/workspace-console-core/settingsModel";
export const localeOptions = [...SETTINGS_PREFERENCES_OPTIONS.locale];
```

```js
// apps/jskit-value-app/src/views/settings/preferences/useSettingsPreferencesForm.js
import { SETTINGS_DEFAULTS } from "@jskit-ai/workspace-console-core/settingsModel";
```

#### Applicability verdict
Still applicable.

#### After applying advice
Create an app-local model and consume that model everywhere:

```js
// apps/jskit-value-app/src/domain/settings/model.js
import { createSettingsModel } from "@jskit-ai/workspace-console-core/settingsModel";

export const APP_SETTINGS_MODEL = createSettingsModel({
  modelExtension: {
    preferencesOptions: {
      locale: [
        { title: "English (US)", value: "en-US" },
        { title: "Spanish (US)", value: "es-US" }
      ],
      currency: ["USD", "EUR"]
    },
    defaults: {
      locale: "en-US",
      currencyCode: "USD"
    }
  }
});
```

```js
// example usage
import { APP_SETTINGS_MODEL } from "../../../domain/settings/model.js";
const { SETTINGS_DEFAULTS, SETTINGS_PREFERENCES_OPTIONS } = APP_SETTINGS_MODEL;
```

---

### 1.7 Browser Error Payload Enrichment Gap Remains Applicable (old `2.9`)

#### Current library code (package side)
The package currently produces base payload from path/surface/UA:

```js
// packages/observability/observability-core/src/browserPayload.js
function createBrowserErrorPayloadTools({ resolveSurfaceFromPathname } = {}) { ... }
```

#### Current app usage
The app currently sends package-created payload directly:

```js
// apps/jskit-value-app/src/services/browserErrorReporter.js
const payload = createPayloadFromErrorEvent(event);
void sendBrowserErrorReport(payload);
```

#### Applicability verdict
Still applicable.

#### After applying advice
Enrich payload before sending (workspace/user context):

```js
function enrichPayload(payload) {
  const workspaceSlug = String(window.location.pathname.split("/")[2] || "").trim();
  const userId = String(window.__APP_CONTEXT__?.userId || "").trim();
  return {
    ...payload,
    metadata: {
      ...(payload.metadata || {}),
      workspaceSlug,
      userId
    }
  };
}

const payload = enrichPayload(createPayloadFromErrorEvent(event));
void sendBrowserErrorReport(payload);
```

---

## 2) Partially Applicable (Core Recommendation Still Valid, Old Examples Stale)

### 2.1 Pagination Recommendation Is Still Valid, Wrapper Example Is Stale (old `2.1`)

#### Current library code (package side)
Composables are unchanged:

```js
// packages/web/web-runtime-core/src/useUrlListPagination.js
function useUrlListPagination({ pageKey, pageSizeKey, initialPageSize, defaultPageSize, pageSizeOptions } = {}) { ... }
```

```js
// packages/web/web-runtime-core/src/useListQueryState.js
function useListQueryState(query, { resolveTotalPages } = {}) { ... }
```

#### Current app usage
App now imports directly in feature/view composables:

```js
// apps/jskit-value-app/src/views/projects/useProjectsList.js
import { useListQueryState } from "@jskit-ai/web-runtime-core/useListQueryState";
import { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";
```

The old report's pass-through wrapper example in `src/composables` is no longer current (those wrapper files were removed).

#### Applicability verdict
Partially applicable: recommendation is valid, old "current usage" example is stale.

#### After applying advice
If standardization is desired, reintroduce meaningful app presets (not pass-through):

```js
// apps/jskit-value-app/src/composables/useStandardListPagination.js
import { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";

export function useStandardListPagination({ keyPrefix, initialPageSize, pageSizeOptions }) {
  return useUrlListPagination({
    pageKey: `${keyPrefix}Page`,
    pageSizeKey: `${keyPrefix}PageSize`,
    initialPageSize,
    defaultPageSize: pageSizeOptions[0],
    pageSizeOptions
  });
}
```

---

### 2.2 Chat Runtime Policy Recommendation Is Valid, API References Were Stale (old `2.4`)

#### Current library code (package side)
Runtime is now factory-based (`createChatRuntime`), not `configureChatRuntime`:

```js
// packages/chat/chat-client-runtime/src/useChatRuntime.js
const CHAT_MESSAGE_MAX_TEXT_CHARS = 4000;
const CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE = 5;
const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;

function createChatRuntime(deps = {}) { ... }
```

#### Current app usage
The app now configures chat runtime in `src/runtime/chatRuntime.js`:

```js
// apps/jskit-value-app/src/runtime/chatRuntime.js
const chatRuntime = createChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});
```

#### Applicability verdict
Partially applicable: policy-injection gap is still valid, but old file/API references are outdated.

#### After applying advice
Extend package runtime factory to accept optional policy, then pass app policy:

```js
// package-side sketch
function createChatRuntime(deps = {}) {
  const runtimeDeps = resolveChatRuntimeDependencies(deps);
  const policy = {
    messageMaxChars: Number(deps.policy?.messageMaxChars || CHAT_MESSAGE_MAX_TEXT_CHARS),
    attachmentMaxFilesPerMessage: Number(
      deps.policy?.attachmentMaxFilesPerMessage || CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE
    ),
    attachmentMaxUploadBytes: Number(deps.policy?.attachmentMaxUploadBytes || CHAT_ATTACHMENT_MAX_UPLOAD_BYTES)
  };
  function useBoundChatRuntime() {
    return useChatRuntime(runtimeDeps, { policy });
  }
  return { useChatRuntime: useBoundChatRuntime, useChatView: useBoundChatRuntime, chatRuntimeTestables };
}
```

```js
// app-side usage
const chatRuntime = createChatRuntime({
  ...deps,
  policy: {
    messageMaxChars: 6000,
    attachmentMaxFilesPerMessage: 8,
    attachmentMaxUploadBytes: 25_000_000
  }
});
```

---

### 2.3 Assistant Runtime Policy Recommendation Is Valid, API References Were Stale (old `2.5`)

#### Current library code (package side)
Runtime is now factory-based (`createAssistantRuntime`), not `configureAssistantRuntime`:

```js
// packages/ai-agent/assistant-client-runtime/src/useAssistantRuntime.js
const ASSISTANT_STREAM_TIMEOUT_MS = 60_000;
const HISTORY_PAGE_SIZE = 50;
const RESTORE_MESSAGES_PAGE_SIZE = 500;

function createAssistantRuntime(deps = {}) { ... }
```

#### Current app usage
The app configures assistant runtime in `src/runtime/assistantRuntime.js`:

```js
// apps/jskit-value-app/src/runtime/assistantRuntime.js
const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});
```

#### Applicability verdict
Partially applicable: tuning gap remains, old file/API references were outdated.

#### After applying advice
Add optional `policy` injection in package runtime factory:

```js
// package-side sketch
function createAssistantRuntime(deps = {}) {
  const runtimeDeps = resolveAssistantRuntimeDependencies(deps);
  const policy = {
    streamTimeoutMs: Number(deps.policy?.streamTimeoutMs || ASSISTANT_STREAM_TIMEOUT_MS),
    historyPageSize: Number(deps.policy?.historyPageSize || HISTORY_PAGE_SIZE),
    restoreMessagesPageSize: Number(deps.policy?.restoreMessagesPageSize || RESTORE_MESSAGES_PAGE_SIZE)
  };
  function useBoundAssistantRuntime() {
    return useAssistantRuntime(runtimeDeps, { policy });
  }
  return {
    useAssistantRuntime: useBoundAssistantRuntime,
    useAssistantView: useBoundAssistantRuntime,
    assistantRuntimeTestables
  };
}
```

```js
// app-side usage
const assistantRuntime = createAssistantRuntime({
  ...deps,
  policy: {
    streamTimeoutMs: 90_000,
    historyPageSize: 100,
    restoreMessagesPageSize: 800
  }
});
```

---

## 3) Low-Impact Caveat

### 3.1 OAuth Provider Catalog Staticness Is Technically Applicable, Low Immediate Impact (old `2.7`)

#### Current library code (package side)
Provider metadata remains static and currently only contains `google`:

```js
// packages/auth/access-core/src/oauthProviders.js
const AUTH_OAUTH_PROVIDER_METADATA = Object.freeze({
  google: Object.freeze({ id: "google", label: "Google" })
});
const AUTH_OAUTH_PROVIDERS = Object.freeze(Object.keys(AUTH_OAUTH_PROVIDER_METADATA));
```

#### Current app usage
Login and security views still map package providers directly:

```js
// apps/jskit-value-app/src/views/login/useLoginView.js
const oauthProviders = AUTH_OAUTH_PROVIDERS
  .map((providerId) => AUTH_OAUTH_PROVIDER_METADATA[providerId])
  .filter(Boolean);
```

#### Applicability verdict
Still technically applicable, but low priority right now because only one provider is present.

#### After applying advice
Optional app-level filter layer for rollout/order control:

```js
// apps/jskit-value-app/src/features/auth/oauthProviders.js
import { AUTH_OAUTH_PROVIDER_METADATA, AUTH_OAUTH_PROVIDERS } from "@jskit-ai/access-core/oauthProviders";

const enabled = new Set((import.meta.env.VITE_ENABLED_OAUTH_PROVIDERS || "google").split(",").map((v) => v.trim()));

export const appOAuthProviders = AUTH_OAUTH_PROVIDERS
  .filter((id) => enabled.has(id))
  .map((id) => AUTH_OAUTH_PROVIDER_METADATA[id])
  .filter(Boolean);
```

---

## 4) Status Summary

1. **Still applicable:** old `1.1`, `1.2`, `2.0`, `2.2`, `2.3`, `2.6`, `2.9`
2. **Partially applicable (update examples/API references):** old `2.1`, `2.4`, `2.5`
3. **Technically applicable but low immediate ROI:** old `2.7`
