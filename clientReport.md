# Client-Side Report: `apps/jskit-value-app/src`

## Scope
This report answers:
1. What web components and supporting composables/libraries exist on the client side.
2. Which used elements come from `packages/`, and what customization opportunities are currently missed.

It focuses on `apps/jskit-value-app/src` and package code under `packages/` that is imported by that client.

---

## 1) Inventory: Web Components and Supporting Client Libraries

### 1.1 Rendered UI Components (what is actually on screen)
Current state:
1. The app renders **Vue SFC views/components** in `apps/jskit-value-app/src`.
2. UI primitives are primarily **Vuetify components** (`v-app`, `v-card`, `v-btn`, `v-list`, `v-dialog`, etc.).
3. There are no package-provided Vue UI components in `packages/` right now (no `.vue` files there).

Representative app usage:

```vue
<!-- apps/jskit-value-app/src/shells/app/AppShell.vue -->
<v-app class="bg-background" :style="workspaceThemeStyle">
  <v-app-bar ... />
  <v-navigation-drawer ... />
  <v-main ...>
    <Outlet />
  </v-main>
</v-app>
```

What it would look like after applying advice (if you want reusable UI in `packages/`):
1. Extract repeated shell/chat/assistant layout primitives into a package like `@jskit-ai/ui-vue`.
2. Keep app-level composition and permissions, but consume shared visual building blocks.

Example target usage:

```vue
<!-- apps/jskit-value-app/src/shells/app/AppShell.vue -->
<template>
  <WorkspaceShellLayout
    :workspace-theme-style="workspaceThemeStyle"
    :navigation-items="navigationItems"
    :destination-title="destinationTitle"
    @navigate="goToNavigationItem"
  >
    <Outlet />
  </WorkspaceShellLayout>
</template>
```

---

### 1.2 Supporting Client Libraries in Use

The client currently relies on:
1. Vue (`vue`) + Pinia (`pinia`)
2. TanStack Vue Router / Query
3. Vuetify + MDI icons
4. Uppy (avatar uploads)
5. `@jskit-ai/*` package runtimes/contracts:
   - `@jskit-ai/web-runtime-core`
   - `@jskit-ai/realtime-client-runtime`
   - `@jskit-ai/chat-client-runtime`, `@jskit-ai/chat-contracts`
   - `@jskit-ai/assistant-client-runtime`, `@jskit-ai/assistant-contracts`
   - `@jskit-ai/workspace-console-core`
   - `@jskit-ai/access-core`
   - `@jskit-ai/observability-core`

---

## 2) Package-Backed Elements: Current vs Improved

Each section includes:
1. What the package code looks like now (library side).
2. How this app uses it now.
3. Missing customization.
4. What it should look like after applying advice.

---

### 2.0 UI Layer Not in `packages/` (important baseline)

#### Current library code (package side)
No package-side Vue component library currently exists.

#### Current app usage
Visual components are local SFCs (`AppShell.vue`, `AdminShell.vue`, `ConsoleShell.vue`, `ChatView.vue`, `AssistantView.vue`, settings forms, etc.) plus Vuetify.

#### Missing customization
1. Cross-app UI consistency cannot be tuned centrally from `packages/`.
2. Repeated shell/composer/timeline patterns are maintained separately per app.
3. Design-system-level variant controls are app-local, not package policy.

#### After applying advice
Create shared UI package(s) for repeated high-value primitives:
1. Shell layout (`WorkspaceShellLayout`)
2. Conversation composer (`ConversationComposer`)
3. Message timeline row (`MessageTimelineRow`)

Use package components for structure; keep app-specific policy/state in composables.

---

### 2.1 `@jskit-ai/web-runtime-core` Pagination and Query State Composables

#### Current library code (package side)

```js
// packages/web/web-runtime-core/src/useUrlListPagination.js
function useUrlListPagination({
  pageKey = "page",
  pageSizeKey = "pageSize",
  initialPageSize,
  defaultPageSize,
  pageSizeOptions
} = {}) { ... }
```

```js
// packages/web/web-runtime-core/src/useListQueryState.js
function useListQueryState(query, { resolveTotalPages } = {}) { ... }
```

#### Current app usage
Thin pass-through wrappers:

```js
// apps/jskit-value-app/src/composables/useUrlListPagination.js
export { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";
```

Repeated per-view config:

```js
// apps/jskit-value-app/src/views/projects/useProjectsList.js
const pagination = useUrlListPagination({
  pageKey: PROJECTS_PAGE_QUERY_KEY,
  pageSizeKey: PROJECTS_PAGE_SIZE_QUERY_KEY,
  initialPageSize,
  defaultPageSize: projectPageSizeOptions[0],
  pageSizeOptions: projectPageSizeOptions
});
```

#### Missing customization
1. No app-level pagination presets, so keys/options are repeated in many views.
2. Inconsistent key naming strategy risk across features.
3. No app-level telemetry hook for pagination changes.

#### After applying advice
Add app-level wrappers with domain presets.

```js
// apps/jskit-value-app/src/composables/useStandardListPagination.js
import { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";

export function useStandardListPagination({
  keyPrefix,
  initialPageSize,
  pageSizeOptions
}) {
  return useUrlListPagination({
    pageKey: `${keyPrefix}Page`,
    pageSizeKey: `${keyPrefix}PageSize`,
    initialPageSize,
    defaultPageSize: pageSizeOptions[0],
    pageSizeOptions
  });
}
```

Then usage becomes:

```js
const pagination = useStandardListPagination({
  keyPrefix: "projects",
  initialPageSize,
  pageSizeOptions: projectPageSizeOptions
});
```

---

### 2.2 `@jskit-ai/web-runtime-core` Transport Runtime and Command Correlation

#### Current library code (package side)

```js
// packages/web/web-runtime-core/src/transportRuntime.js
function createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker,
  aiStreamUrl = "/api/workspace/ai/chat/stream",
  apiPathPrefix = "/api/",
  realtimeCorrelatedWriteRoutes = DEFAULT_REALTIME_CORRELATED_WRITE_ROUTES
} = {}) { ... }
```

Default correlated routes include projects/settings/invites/member role updates.

#### Current app usage

```js
// apps/jskit-value-app/src/services/api/transport.js
const transportRuntime = createTransportRuntime({
  createSurfacePaths,
  resolveSurfaceFromPathname,
  getClientId,
  commandTracker
});
```

#### Missing customization
1. Correlated write routes are default-only; chat writes are not included by default.
2. No custom command-id strategy or policy per surface.
3. No app-specific extension of stream endpoint detection if endpoints evolve.

#### After applying advice
Explicitly pass route extensions and any custom ID policy.

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
  ]
});
```

---

### 2.3 `@jskit-ai/realtime-client-runtime` Runtime and Command Tracker Policies

#### Current library code (package side)

```js
// packages/realtime/realtime-client-runtime/src/commandTracker.js
const DEFAULT_COMMAND_TRACKER_OPTIONS = {
  commandTtlMs: 30_000,
  finalizedTtlMs: 60_000,
  seenEventTtlMs: 120_000,
  ...
};

function createCommandTracker(options = {}) { ... }
```

```js
// packages/realtime/realtime-client-runtime/src/runtime.js
function createRealtimeRuntime(options = {}) {
  // supports reconnectPolicy, replayPolicy, maintenanceIntervalMs,
  // onConnectionStateChange, transport overrides, etc.
}
```

#### Current app usage

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

#### Missing customization
1. Tracker TTL/capacity uses defaults only.
2. Reconnect/replay policy not tuned for app traffic patterns.
3. No connection-state telemetry callback in app runtime wiring.
4. Socket transport path/event/transports use defaults.

#### After applying advice
Tune tracker/runtime policies explicitly.

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
import { createReconnectPolicy, createReplayPolicy } from "@jskit-ai/realtime-client-runtime";

return createRealtimeClientRuntime({
  ...existing,
  reconnectPolicy: createReconnectPolicy({ baseDelayMs: 800, maxDelayMs: 20_000 }),
  replayPolicy: createReplayPolicy({ maxEventsPerCommand: 40, maxEventsPerTick: 120 }),
  maintenanceIntervalMs: 1500,
  onConnectionStateChange(state) {
    // send to metrics/logger
  },
  transport: createSocketIoTransport({
    socketFactory,
    path: "/api/realtime",
    transports: ["websocket"]
  })
});
```

---

### 2.4 `@jskit-ai/chat-client-runtime` Headless Chat Runtime

#### Current library code (package side)
Chat runtime behavior is driven by internal constants:

```js
// packages/chat/chat-client-runtime/src/useChatRuntime.js
const INBOX_PAGE_SIZE = 20;
const THREAD_MESSAGES_PAGE_SIZE = 50;
const DM_CANDIDATES_PAGE_SIZE = 100;
const CHAT_MESSAGE_MAX_TEXT_CHARS = 4000;
const CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE = 5;
const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;
```

Configured via dependency injection only:

```js
function configureChatRuntime({
  api, subscribeRealtimeEvents, useAuthGuard, useQueryErrorMessage, useWorkspaceStore, realtimeEventTypes
} = {}) { ... }
```

#### Current app usage

```js
// apps/jskit-value-app/src/views/chat/useChatView.js
configureChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});
```

#### Missing customization
1. No per-app/per-surface policy for chat limits (message length, attachment limits, page sizes).
2. No app-controlled typing timing thresholds.
3. These behaviors are effectively fixed until package code changes.

#### After applying advice
Recommended package API extension:

```js
// package: add optional policy
function configureChatRuntime({ ..., policy } = {}) {
  if (policy && typeof policy === "object") {
    CHAT_POLICY = { ...DEFAULT_CHAT_POLICY, ...policy };
  }
}
```

App usage after:

```js
configureChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES,
  policy: {
    messageMaxChars: 6000,
    attachmentsMaxFilesPerMessage: 8,
    attachmentMaxUploadBytes: 25_000_000
  }
});
```

---

### 2.5 `@jskit-ai/assistant-client-runtime` Assistant Runtime

#### Current library code (package side)
Internal fixed policy values:

```js
// packages/ai-agent/assistant-client-runtime/src/useAssistantRuntime.js
const ASSISTANT_STREAM_TIMEOUT_MS = 60_000;
const HISTORY_PAGE_SIZE = 50;
const RESTORE_MESSAGES_PAGE_SIZE = 500;
```

Configuration currently injects only dependencies:

```js
function configureAssistantRuntime({
  api, useWorkspaceStore, resolveSurfaceFromPathname
} = {}) { ... }
```

#### Current app usage

```js
// apps/jskit-value-app/src/views/assistant/useAssistantView.js
configureAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});
```

#### Missing customization
1. No app-level stream timeout tuning.
2. No app-level history page-size policy.
3. No easy way to adapt policy by surface (admin vs app).

#### After applying advice
Recommended package API extension:

```js
function configureAssistantRuntime({ api, useWorkspaceStore, resolveSurfaceFromPathname, policy } = {}) {
  if (policy) {
    ASSISTANT_POLICY = { ...DEFAULT_ASSISTANT_POLICY, ...policy };
  }
}
```

App usage after:

```js
configureAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname,
  policy: {
    streamTimeoutMs: 90_000,
    historyPageSize: 100,
    restoreMessagesPageSize: 800
  }
});
```

---

### 2.6 `@jskit-ai/workspace-console-core` Settings Model and Preferences Options

#### Current library code (package side)
The package already supports extension:

```js
// packages/workspace/workspace-console-core/src/settingsModel.js
function createSettingsModel({ avatar = {}, modelExtension = {} } = {}) { ... }
```

It also exports a platform default model/constants.

#### Current app usage
The app imports static constants directly:

```js
// apps/jskit-value-app/src/views/settings/preferences/lib/settingsPreferencesOptions.js
import { SETTINGS_PREFERENCES_OPTIONS } from "@jskit-ai/workspace-console-core/settingsModel";
export const localeOptions = [...SETTINGS_PREFERENCES_OPTIONS.locale];
```

```js
// apps/jskit-value-app/src/views/settings/preferences/useSettingsPreferencesForm.js
import { SETTINGS_DEFAULTS } from "@jskit-ai/workspace-console-core/settingsModel";
```

#### Missing customization
1. App is not using `createSettingsModel` despite package support.
2. Locale/timezone/currency option sets are fixed to platform defaults.
3. Hard to create product-specific settings profile without editing package defaults.

#### After applying advice
Create an app-local model module built from `createSettingsModel`.

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

Then replace direct platform constant imports:

```js
import { APP_SETTINGS_MODEL } from "../../../domain/settings/model.js";

const { SETTINGS_DEFAULTS, SETTINGS_PREFERENCES_OPTIONS } = APP_SETTINGS_MODEL;
```

---

### 2.7 `@jskit-ai/access-core` OAuth Providers and Auth Method Catalog

#### Current library code (package side)
Provider catalog is static:

```js
// packages/auth/access-core/src/oauthProviders.js
const AUTH_OAUTH_PROVIDER_METADATA = {
  google: { id: "google", label: "Google" }
};
```

#### Current app usage

```js
// apps/jskit-value-app/src/views/login/useLoginView.js
const oauthProviders = AUTH_OAUTH_PROVIDERS
  .map((providerId) => AUTH_OAUTH_PROVIDER_METADATA[providerId])
  .filter(Boolean);
```

Security settings also rely on this metadata for provider labels and actions.

#### Missing customization
1. No app/deployment-level provider allowlist or ordering.
2. Enabling another provider requires package-level code change first.

#### After applying advice
Immediate app-level improvement: add a local provider filter layer.

```js
// apps/jskit-value-app/src/features/auth/oauthProviders.js
import { AUTH_OAUTH_PROVIDER_METADATA, AUTH_OAUTH_PROVIDERS } from "@jskit-ai/access-core/oauthProviders";

const ENABLED = new Set((import.meta.env.VITE_ENABLED_OAUTH_PROVIDERS || "google").split(",").map((v) => v.trim()));

export const appOAuthProviders = AUTH_OAUTH_PROVIDERS
  .filter((id) => ENABLED.has(id))
  .map((id) => AUTH_OAUTH_PROVIDER_METADATA[id])
  .filter(Boolean);
```

Then use this in login/security views instead of raw package list.

Longer-term package improvement: introduce `createOAuthProviderRegistry(...)` so provider catalogs are not compile-time static.

---

### 2.8 Contract Wrappers (`chat-contracts`, `assistant-contracts`, `web-runtime-core/pagination`)

#### Current library code (package side)
Contracts are reusable query key builders and error mappers.

#### Current app usage
Current wrappers are pass-through only:

```js
// apps/jskit-value-app/src/features/chat/queryKeys.js
export { chatInboxInfiniteQueryKey, ... } from "@jskit-ai/chat-contracts";
```

```js
// apps/jskit-value-app/src/features/assistant/queryKeys.js
export { assistantConversationsListQueryKey, ... } from "@jskit-ai/assistant-contracts";
```

#### Missing customization
1. Wrapper layer currently adds almost no behavior.
2. No app-level query-key versioning or namespace policy.

#### After applying advice
Choose one of two clear approaches:
1. Remove wrapper layer and import package contracts directly.
2. Keep wrappers but make them meaningful (add app query namespace/version).

Example meaningful wrapper:

```js
const APP_QUERY_VERSION = "v1";
export function appChatInboxKey(workspaceSlug, options) {
  return ["jskit-value-app", APP_QUERY_VERSION, ...chatInboxInfiniteQueryKey(workspaceSlug, options)];
}
```

---

### 2.9 `@jskit-ai/observability-core/browserPayload` Browser Error Context

#### Current library code (package side)

```js
// packages/observability/observability-core/src/browserPayload.js
function createBrowserErrorPayloadTools({ resolveSurfaceFromPathname } = {}) { ... }
```

#### Current app usage

```js
// apps/jskit-value-app/src/services/browserErrorReporter.js
const browserPayloadTools = createBrowserErrorPayloadTools({
  resolveSurfaceFromPathname
});
```

#### Missing customization
1. Error payload includes surface/path but not richer client context (workspace slug, current user id if available).
2. Harder triage in multi-workspace environments.

#### After applying advice
Add context enrichment before sending payload (app-only now), or extend package API with `resolveContext`.

App-only enrichment example:

```js
function enrichPayload(payload) {
  const workspaceSlug = window.location.pathname.split("/")[2] || "";
  return {
    ...payload,
    metadata: {
      ...(payload.metadata || {}),
      workspaceSlug
    }
  };
}

const payload = enrichPayload(createPayloadFromErrorEvent(event));
```

---

## 3) Direct Answers to Your Original Questions

### Q1. What web components and supporting composables/libraries are there?
1. Visual layer: app-local Vue SFCs + Vuetify components.
2. No package-hosted Vue web components in `packages/` currently.
3. Supporting shared client behavior comes from `@jskit-ai/*` runtimes/contracts/composables listed above.

### Q2. In which cases are used elements in `packages/`, and when they are there, what customization are we missing?
1. Package-backed today: pagination/query composables, transport runtime, realtime runtime/tracker, chat runtime/API, assistant runtime/API, auth/provider catalog, settings model constants, contracts/query keys, browser payload tools.
2. Main missed opportunities:
   - using defaults where package exposes policy hooks (transport/realtime/tracker),
   - not using extension APIs that already exist (`createSettingsModel`),
   - depending on package-fixed constants where policy should be app-configurable (chat/assistant limits, OAuth provider catalog),
   - keeping pass-through wrappers that do not encode app policy.

---

## 4) Recommended Implementation Order
1. **High impact, low risk:** transport route extensions + realtime policy tuning.
2. **High impact, low risk:** app-local settings model via `createSettingsModel`.
3. **Medium impact:** app-level OAuth provider filter wrapper.
4. **Medium impact:** standard pagination wrapper presets.
5. **Higher effort (package changes):** chat/assistant runtime policy injection APIs.
