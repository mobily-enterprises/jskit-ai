# Client-Side Report (Current Paths Only): `apps/jskit-value-app/src`

## Scope
This report intentionally covers only:
1. still-applicable baseline/inventory (`1.1`, `1.2`, `2.0`)
2. partially applicable items (`2.1`, `2.4`, `2.5`)

All examples use the current file paths after the app tree refactor.

---

## 1) Still-Applicable Baseline / Inventory

### 1.1 UI Inventory Remains Correct

#### Current library code (package side)
There is still no package-provided Vue component library in `packages/`:

```bash
# repo root
rg --files packages -g '*.vue'
# no results
```

#### Current app usage
The visual layer remains app-local Vue SFCs + Vuetify:

```vue
<!-- apps/jskit-value-app/src/app/shells/app/AppShell.vue -->
<v-app class="bg-background" :style="workspaceThemeStyle">
  ...
  <Outlet />
</v-app>
```

#### Applicability verdict
Still applicable.

#### After applying advice
If shared UI primitives are desired, app usage would move to package components (example):

```vue
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

### 1.2 Supporting Client Libraries Inventory Is Still Informative

#### Current app usage
The client still depends on Vue/Pinia, TanStack Router/Query, Vuetify, Uppy, and `@jskit-ai/*` runtimes/contracts.

Representative current imports:

```js
// apps/jskit-value-app/src/modules/chat/runtime.js
import { createChatRuntime } from "@jskit-ai/chat-client-runtime";
import { useQueryErrorMessage } from "@jskit-ai/web-runtime-core";
```

```js
// apps/jskit-value-app/src/modules/assistant/runtime.js
import { createAssistantRuntime } from "@jskit-ai/assistant-client-runtime";
```

```js
// apps/jskit-value-app/src/platform/http/api/index.js
import { createApi as createAiApi } from "@jskit-ai/assistant-client-runtime";
import { createApi as createChatApi } from "@jskit-ai/chat-client-runtime";
```

#### Applicability verdict
Still applicable as informational inventory.

#### After applying advice
No required change. This section is descriptive.

---

### 2.0 UI Layer Is Still Not Package-Hosted

#### Current app usage
UI composition remains local to the app:
1. `apps/jskit-value-app/src/app/shells/*`
2. `apps/jskit-value-app/src/views/*`
3. `apps/jskit-value-app/src/components/*`

#### Applicability verdict
Still applicable.

#### After applying advice
If cross-app UI consistency becomes a goal, extract high-reuse layout/composer/timeline primitives to a shared package and keep app policy/state local.

---

## 2) Partially Applicable (Core Recommendation Still Valid)

### 2.1 `web-runtime-core` Pagination Recommendation Is Still Valid (Paths Updated)

#### Current library code (package side)

```js
// packages/web/web-runtime-core/src/useUrlListPagination.js
function useUrlListPagination({ pageKey, pageSizeKey, initialPageSize, defaultPageSize, pageSizeOptions } = {}) { ... }
```

```js
// packages/web/web-runtime-core/src/useListQueryState.js
function useListQueryState(query, { resolveTotalPages } = {}) { ... }
```

#### Current app usage
The app imports these composables directly in views/components:

```js
// apps/jskit-value-app/src/views/projects/useProjectsList.js
import { useListQueryState } from "@jskit-ai/web-runtime-core/useListQueryState";
import { useUrlListPagination } from "@jskit-ai/web-runtime-core/useUrlListPagination";
```

```js
// apps/jskit-value-app/src/views/console/useConsoleBillingEventsView.js
const pagination = useUrlListPagination({
  pageKey: "page",
  pageSizeKey: "pageSize",
  initialPageSize: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS[0],
  defaultPageSize: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS[0],
  pageSizeOptions: CONSOLE_BILLING_EVENTS_PAGE_SIZE_OPTIONS
});
```

#### Applicability verdict
Partially applicable: direct usage is fine, but app-level pagination presets are still not standardized.

#### After applying advice
Introduce a meaningful app wrapper (preset conventions, not pass-through):

```js
// apps/jskit-value-app/src/modules/pagination/useStandardListPagination.js
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

### 2.4 `chat-client-runtime` Policy Injection Is Still Partially Applicable

#### Current library code (package side)
Runtime is factory-based and still keeps policy values internal constants:

```js
// packages/chat/chat-client-runtime/src/useChatRuntime.js
const CHAT_MESSAGE_MAX_TEXT_CHARS = 4000;
const CHAT_ATTACHMENTS_MAX_FILES_PER_MESSAGE = 5;
const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;

function createChatRuntime(deps = {}) { ... }
```

#### Current app usage
Current app runtime wiring (new path):

```js
// apps/jskit-value-app/src/modules/chat/runtime.js
const chatRuntime = createChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});
```

Used from view:

```js
// apps/jskit-value-app/src/views/chat/ChatView.vue
import { useChatView } from "../../modules/chat/runtime.js";
```

#### Applicability verdict
Partially applicable: moved paths are now correct, but package-level runtime policy injection is still unavailable.

#### After applying advice
Add optional `policy` to package factory, then pass app policy:

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
// app-side usage sketch
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

### 2.5 `assistant-client-runtime` Policy Injection Is Still Partially Applicable

#### Current library code (package side)
Runtime is factory-based and policy values are still internal constants:

```js
// packages/ai-agent/assistant-client-runtime/src/useAssistantRuntime.js
const ASSISTANT_STREAM_TIMEOUT_MS = 60_000;
const HISTORY_PAGE_SIZE = 50;
const RESTORE_MESSAGES_PAGE_SIZE = 500;

function createAssistantRuntime(deps = {}) { ... }
```

#### Current app usage
Current app runtime wiring (new path):

```js
// apps/jskit-value-app/src/modules/assistant/runtime.js
const assistantRuntime = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});
```

Used from view:

```js
// apps/jskit-value-app/src/views/assistant/AssistantView.vue
import { useAssistantView } from "../../modules/assistant/runtime.js";
```

#### Applicability verdict
Partially applicable: moved paths are now correct, but package-level assistant policy injection is still unavailable.

#### After applying advice
Add optional `policy` to package factory, then pass app policy:

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
// app-side usage sketch
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

## Summary
1. Still-applicable baseline/inventory: `1.1`, `1.2`, `2.0`
2. Partially applicable items: `2.1`, `2.4`, `2.5`
