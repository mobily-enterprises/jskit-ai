# `@jskit-ai/chat-contracts`

## What This Package Is For

`@jskit-ai/chat-contracts` is the shared "vocabulary" for chat clients.

It gives you:

1. Stable query-key builders for Vue Query caches.
2. A consistent way to map server chat errors into user-facing messages.

Use this package when you need predictable cache keys and predictable chat error messages across apps.

## Why Apps Use It

In `apps/jskit-value-app`, this package is used by chat runtime/composables so:

1. The inbox cache key in one screen matches the key invalidated after sending a message.
2. Error messages shown to users are consistent for the same backend error code.

Without this package, each app can invent slightly different key shapes and error-copy logic, which causes stale cache bugs and inconsistent UX.

## Public API

### `CHAT_QUERY_KEY_PREFIX`

What it does:

- The root chat query key prefix (`["chat"]`).

Real-life example:

- You want to invalidate all chat queries at logout:

```js
queryClient.invalidateQueries({ queryKey: CHAT_QUERY_KEY_PREFIX });
```

Why apps use it:

- One shared root makes broad cache cleanup easy and reliable.

### `chatRootQueryKey()`

What it does:

- Returns a fresh root key array for chat.

Real-life example:

```js
const key = chatRootQueryKey();
// ["chat"]
```

Why apps use it:

- Avoids hardcoded strings spread across files.

### `chatScopeQueryKey(workspaceSlug)`

What it does:

- Builds a workspace-scoped base key.
- Normalizes empty/missing slug to `"none"`.

Real-life example:

```js
chatScopeQueryKey("acme");
// ["chat", "acme"]
```

Why apps use it:

- Prevents accidental key collisions between workspaces.

### `chatInboxInfiniteQueryKey(workspaceSlug, { limit })`

What it does:

- Builds the key for paginated inbox threads.
- Normalizes limit to a positive integer (fallback `20`).

Real-life example:

```js
chatInboxInfiniteQueryKey("acme", { limit: 20 });
// ["chat", "acme", "inbox", "infinite", 20]
```

Why apps use it:

- The same key is reused for fetch and invalidation after thread/message changes.

### `chatThreadQueryKey(workspaceSlug, threadId)`

What it does:

- Builds the key for one thread record.
- Invalid thread IDs normalize to `"none"`.

Real-life example:

```js
chatThreadQueryKey("acme", 42);
// ["chat", "acme", "threads", "42"]
```

Why apps use it:

- Lets apps refetch one thread without touching all chat data.

### `chatThreadMessagesInfiniteQueryKey(workspaceSlug, threadId, { limit })`

What it does:

- Builds the paginated key for one thread's messages.
- Limit fallback is `50`.

Real-life example:

```js
chatThreadMessagesInfiniteQueryKey("acme", 42, { limit: 50 });
// ["chat", "acme", "threads", "42", "messages", "infinite", 50]
```

Why apps use it:

- The app invalidates this key right after `sendThreadMessage`.

### `mapChatError(error, fallbackMessage)`

What it does:

- Converts backend chat errors into a normalized UI object:
  - `message`
  - `errorCode`
  - `fieldErrorSummary`
- Priority order:
  1. field errors
  2. known chat code mapping
  3. backend message
  4. fallback message

Real-life example:

```js
mapChatError(
  {
    details: { code: "CHAT_IDEMPOTENCY_CONFLICT" }
  },
  "Unable to send message."
);
// {
//   message: "Duplicate message id conflicts with different content.",
//   errorCode: "CHAT_IDEMPOTENCY_CONFLICT",
//   fieldErrorSummary: ""
// }
```

Why apps use it:

- Users get a friendly deterministic message instead of raw backend text.

### `chatErrorTestables`

What it does:

- Exposes low-level helpers for unit tests (`summarizeFieldErrors`, code-to-message mapping).

Real-life example:

- A test verifies your error copy rules did not regress after refactoring.

Why apps use it:

- Keeps behavior testable without reimplementing internal logic.

## How It Is Used In Real App Flow

Example: user sends a chat message.

1. UI calls chat runtime action.
2. Runtime sends API request.
3. On success, runtime invalidates:
   - `chatThreadMessagesInfiniteQueryKey(...)`
   - `chatInboxInfiniteQueryKey(...)`
4. On failure, runtime uses `mapChatError(...)` to show user-safe text.

This package is exactly what makes step 3 and step 4 consistent in every app.
