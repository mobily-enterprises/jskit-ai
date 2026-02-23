# `@jskit-ai/assistant-contracts`

## What This Package Is For

`@jskit-ai/assistant-contracts` is the shared contract layer for assistant features.

It provides:

1. Query-key builders for assistant conversation data.
2. Query-key builders for transcript data.
3. Stream event constants + normalization helpers.

## Why Apps Use It

In `apps/jskit-value-app`, this package ensures:

1. Conversation list/message caches use stable keys.
2. Transcript pages and message pages use stable keys.
3. Stream events are interpreted consistently by API/runtime layers.

Without this package, each app can drift in key formats and stream event strings.

## Public API

## Assistant Query Key API

### `ASSISTANT_QUERY_KEY_PREFIX`

- Root key prefix for assistant data.
- Example: invalidate all assistant caches after workspace switch.

### `assistantRootQueryKey()`

- Returns assistant root key array.
- Example: `["assistant"]`.

### `assistantWorkspaceScopeQueryKey(workspaceScope)`

- Builds scope key by workspace id or slug.
- Example:

```js
assistantWorkspaceScopeQueryKey({ workspaceId: 11 });
// ["assistant", "id:11"]
```

### `assistantConversationsListQueryKey(workspaceScope, { page, pageSize, status })`

- Key for conversation list pages.
- Example:

```js
assistantConversationsListQueryKey({ workspaceSlug: "acme" }, { page: 1, pageSize: 50, status: "completed" });
```

### `assistantConversationMessagesQueryKey(workspaceScope, conversationId, { page, pageSize })`

- Key for one conversation's message pages.
- Example:

```js
assistantConversationMessagesQueryKey({ workspaceId: 11 }, 42, { page: 1, pageSize: 500 });
```

Why apps use these:

- Cache invalidation/refetch is only reliable when every caller uses the same key builder.

## Transcript Query Key API

### `WORKSPACE_AI_TRANSCRIPTS_QUERY_KEY_PREFIX`

- Root key prefix for workspace transcript features.

### `workspaceAiTranscriptsRootQueryKey()`

- Returns transcript root key.

### `workspaceAiTranscriptsScopeQueryKey(workspaceSlug)`

- Builds transcript scope key by workspace slug.

### `workspaceAiTranscriptsListQueryKey(workspaceSlug, { page, pageSize, status, createdByUserId })`

- Key for transcript conversation lists.
- Example: console transcript table with filters.

### `workspaceAiTranscriptMessagesQueryKey(workspaceSlug, conversationId, { page, pageSize })`

- Key for transcript message pagination.
- Example: open transcript detail drawer and fetch entries.

Why apps use these:

- Transcript UI and admin tools can share one predictable cache model.

## Stream Event API

### `ASSISTANT_STREAM_EVENT_TYPES`

- Canonical event names:
  - `meta`
  - `assistant_delta`
  - `assistant_message`
  - `tool_call`
  - `tool_result`
  - `error`
  - `done`

Real-life example:

- A runtime checks if an incoming line is `ASSISTANT_STREAM_EVENT_TYPES.ERROR` before deciding to fail request state.

### `ASSISTANT_STREAM_EVENT_TYPE_VALUES`

- Array of all valid event type strings.

Real-life example:

- Validate outbound event schemas at startup.

### `normalizeAssistantStreamEventType(value, fallback = "")`

- Trims/lowercases and only accepts known types.
- Unknown values become fallback.

Example:

```js
normalizeAssistantStreamEventType(" ERROR ");
// "error"
```

### `isAssistantStreamEventType(value)`

- True/false check for valid event types.

Example:

```js
isAssistantStreamEventType("tool_call"); // true
isAssistantStreamEventType("x"); // false
```

### `normalizeAssistantStreamEvent(event)`

- Returns normalized event object with sanitized `type`.

Example:

```js
normalizeAssistantStreamEvent({ type: " TOOL_RESULT ", ok: true });
// { type: "tool_result", ok: true }
```

Why apps use stream helpers:

- Prevents subtle bugs caused by casing/spacing/unknown event types.

## How It Is Used In Real App Flow

1. Client runtime builds query keys from this package for list/detail cache entries.
2. Assistant API client normalizes stream event types before error handling.
3. Server adapter and client runtime both rely on same event vocabulary.

That shared vocabulary is why app and backend stay in sync.
