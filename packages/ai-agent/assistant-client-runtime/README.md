# `@jskit-ai/assistant-client-runtime`

## What This Package Is For

`@jskit-ai/assistant-client-runtime` is the headless client runtime for assistant UI features.

It provides:

1. Assistant API client builder (stream/list/get).
2. Assistant runtime composable with state/actions for streaming and conversation history.

It does not include visual components. Your app still owns `AssistantView.vue` and styling.

## Why Apps Use It

In `apps/jskit-value-app`, the app composition root instantiates this runtime with app-owned transport/store/routing dependencies.

This allows shared behavior while preserving app-specific UI decisions.

## Public API

## `createApi({ request, requestStream })` / `createAssistantApi(...)`

What it does:

- Builds assistant HTTP client around injected transport functions.

Returned methods and practical examples:

1. `streamChat(payload, options)`
   - Calls assistant NDJSON stream endpoint.
   - Emits parsed stream events through `onEvent` callback.
   - Can reject when stream emits `type:error`.
   - Example: stream assistant response as user asks question.
2. `listConversations(query)`
   - List conversation history.
   - Example: sidebar of previous assistant sessions.
3. `getConversationMessages(conversationId, query)`
   - Load messages for one conversation.
   - Example: restore selected historical conversation into timeline.

## `buildStreamEventError(event)`

What it does:

- Converts stream `error` event payload to Error object with `code`, `status`, and original event.

Practical example:

- Stream emits provider error -> runtime catches normalized Error and shows user-safe message.

## `createAssistantRuntime(deps)`

What it does:

- Creates a factory-created runtime instance with app-specific dependencies:
  - `api`
  - `useWorkspaceStore`
  - `resolveSurfaceFromPathname`

Practical example:

```js
import { createAssistantRuntime } from "@jskit-ai/assistant-client-runtime";

const { useAssistantView, assistantRuntimeTestables } = createAssistantRuntime({
  api,
  useWorkspaceStore,
  resolveSurfaceFromPathname
});
```

Why apps use it:

- Runtime stays reusable without importing app internals directly.

## `useAssistantRuntime()` / `useAssistantView()`

What it does:

- Returns assistant runtime object with:
  - `meta` helpers
  - `state` refs/computed values
  - `actions`

Important actions and practical examples:

1. `sendMessage()`
   - Starts a stream turn from current input.
   - Example: user asks "rename my workspace".
2. `handleInputKeydown(event)`
   - Enter-to-send behavior.
   - Example: send on Enter, keep Shift+Enter newline.
3. `cancelStream()`
   - Aborts active stream request.
   - Example: user presses "Stop generating".
4. `startNewConversation()` / `clearConversation()`
   - Resets local timeline and active conversation context.
   - Example: user clicks "New conversation".
5. `selectConversation(conversation)`
   - Loads historical conversation by object.
   - Example: click item in history list.
6. `selectConversationById(id)`
   - Loads historical conversation by id.
   - Example: route param-based restore.
7. `refreshConversationHistory()`
   - Refetches conversation list.
   - Example: refresh after a completed stream.

Important meta helpers:

1. `formatConversationStartedAt(value)`
   - Formats start timestamp.
2. `normalizeConversationStatus(value)`
   - Normalizes status labels.

Why apps use it:

- Gives complete assistant behavior (streaming, tool timeline state, history restore) without coupling to specific UI layout.

## `assistantRuntimeTestables`

What it does:

- Test-focused helpers such as:
  - history builder
  - transcript-to-runtime mapping
  - tool summary generation

Practical example:

- Test that tool timeline rows are excluded from model history on follow-up turns.

## How It Is Used In Real App Flow

1. App composition root (`apps/jskit-value-app/src/runtime/assistantRuntime.js`) instantiates runtime dependencies once.
2. `AssistantView.vue` calls `useAssistantView()`.
3. User sends input -> `sendMessage()` calls `api.streamChat(...)`.
4. Stream events update timeline/tool state in real time.
5. On completion, conversation history is invalidated and refreshed.

This package is the shared behavior engine for assistant UI runtimes.
