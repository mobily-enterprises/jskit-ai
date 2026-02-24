# `@jskit-ai/chat-client-runtime`

## What This Package Is For

`@jskit-ai/chat-client-runtime` is the headless client-side runtime for chat.

It provides:

1. A chat HTTP client builder.
2. A reusable composable runtime that manages chat state/actions.

It intentionally does not include UI components. Your app still owns `ChatView.vue` styling and layout.

## Why Apps Use It

In `apps/jskit-value-app`, this package is wired by the app composition root (`src/runtime/chatRuntime.js`) that injects app dependencies (API, auth guard, workspace store, realtime bus).

This keeps shared behavior reusable while allowing app-specific policy/UI choices.

## Public API

## `createApi({ request })` / `createChatApi({ request })`

What it does:

- Builds a chat API client around your transport function.

Returned methods and practical examples:

1. `ensureWorkspaceRoom(payload)`
   - Ensure workspace room exists.
   - Example: open team room when chat view loads.
2. `listDmCandidates(query)`
   - Query possible DM targets.
   - Example: search for teammate before starting DM.
3. `ensureDm(payload)`
   - Create/find DM thread.
   - Example: start private chat with `targetPublicChatId`.
4. `listInbox(query)`
   - Paginated inbox threads.
   - Example: fetch next inbox page on scroll.
5. `getThread(threadId)`
   - Fetch one thread.
   - Example: refresh thread metadata.
6. `listThreadMessages(threadId, query)`
   - Paginated messages.
   - Example: load older message page.
7. `sendThreadMessage(threadId, payload)`
   - Send message text/attachments.
   - Example: submit composer.
8. `reserveThreadAttachment(threadId, payload)`
   - Reserve attachment slot.
   - Example: preflight attachment upload.
9. `uploadThreadAttachment(threadId, formData)`
   - Upload binary payload.
   - Example: send selected file bytes.
10. `deleteThreadAttachment(threadId, attachmentId)`
    - Delete staged attachment.
    - Example: remove file from composer.
11. `markThreadRead(threadId, payload)`
    - Update read cursor.
    - Example: mark latest seq as seen.
12. `emitThreadTyping(threadId)`
    - Emit typing signal.
    - Example: show typing indicator to other users.

## `createChatRuntime(deps)`

What it does:

- Creates a factory-created runtime instance with app-specific dependencies:
  - `api`
  - `subscribeRealtimeEvents`
  - `useAuthGuard`
  - `useQueryErrorMessage`
  - `useWorkspaceStore`
  - `realtimeEventTypes`

Real-life example:

```js
import { createChatRuntime } from "@jskit-ai/chat-client-runtime";

const { useChatView, chatRuntimeTestables } = createChatRuntime({
  api,
  subscribeRealtimeEvents,
  useAuthGuard,
  useQueryErrorMessage,
  useWorkspaceStore,
  realtimeEventTypes: REALTIME_EVENT_TYPES
});
```

Why apps use it:

- Keeps package app-agnostic while still using app wiring.

## `useChatRuntime()` / `useChatView()`

What it does:

- Returns a full headless chat runtime object:
  - `meta` (limits/page sizes)
  - `state` (reactive data)
  - `helpers` (formatters)
  - `actions` (operations)

Important action functions and practical examples:

1. `ensureWorkspaceRoom()`
   - Ensure/select workspace chat room.
   - Example: auto-open room on first chat visit.
2. `backToWorkspaceRoom()`
   - Jump from DM back to room.
   - Example: "Back to workspace chat" button.
3. `selectThread(threadId)`
   - Switch active thread.
   - Example: click thread in inbox.
4. `ensureDmThread(publicChatId)`
   - Create/find DM and select it.
   - Example: start direct message from search.
5. `refreshDmCandidates({ search })`
   - Refresh DM search results.
   - Example: update candidates as user types.
6. `refreshInbox()`
   - Refetch inbox.
   - Example: manual refresh action.
7. `refreshThread()`
   - Refetch selected thread messages.
   - Example: refresh after reconnect.
8. `loadMoreThreads()`
   - Fetch next inbox page.
   - Example: infinite scrolling thread list.
9. `loadOlderMessages()`
   - Fetch older thread messages.
   - Example: "Load older" in thread history.
10. `sendFromComposer()`
    - Send composed message.
    - Example: send text with uploaded files.
11. `handleComposerKeydown(event)`
    - Enter-to-send behavior.
    - Example: press Enter to send, Shift+Enter newline.
12. `addComposerFiles(files)`
    - Queue and upload selected files.
    - Example: attach screenshots to message.
13. `retryComposerAttachment(localId)`
    - Retry failed upload.
    - Example: user retries after temporary network error.
14. `removeComposerAttachment(localId)`
    - Remove attachment from composer.
    - Example: remove wrong file before send.

Why apps use it:

- Gives complete chat behavior without forcing UI implementation details.

## `chatRuntimeTestables`

What it does:

- Exposes selected internals for unit tests (normalizers/flatten helpers/message grouping).

Real-life example:

- Test that timeline grouping stays stable after refactor.

## How It Is Used In Real App Flow

1. App composition root (`apps/jskit-value-app/src/runtime/chatRuntime.js`) creates a runtime instance with `createChatRuntime(...)`.
2. `ChatView.vue` calls `useChatView()`.
3. UI binds to `state` fields.
4. UI triggers `actions` on clicks/keyboard/file events.
5. Runtime handles query invalidation, error mapping, typing state, and attachment flow.

This package is the shared behavior layer between transport and visual UI.
