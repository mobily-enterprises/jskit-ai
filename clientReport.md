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
// apps/jskit-value-app/src/features/auth/oauthProviders.js
import {
  AUTH_OAUTH_DEFAULT_PROVIDER,
  AUTH_OAUTH_PROVIDER_METADATA,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider
} from "@jskit-ai/access-core/oauthProviders";
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

## 3) Status Summary

1. **Still applicable:** old `1.1`, `1.2`, `2.0`
2. **Partially applicable (update examples/API references):** old `2.1`, `2.4`, `2.5`
