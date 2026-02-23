# `@jskit-ai/chat-core`

## What This Package Is For

`@jskit-ai/chat-core` contains chat business logic that should be shared across apps.

It does not know about Fastify routes or Vue components. It only handles domain behavior such as:

1. Thread/message operations.
2. Attachment and reaction rules.
3. Read-cursor and typing behavior.
4. Realtime publish payload shaping.

## Why Apps Use It

In `apps/jskit-value-app`, server wrappers call this package so app endpoints keep behavior parity while moving shared logic out of the app.

This gives you:

1. One place for chat rules (rate limits, payload normalization, idempotency).
2. Easier reuse in future apps.
3. Cleaner adapter/core separation.

## Public API

## `toCanonicalJson(value)`

What it does:

- Serializes objects in deterministic key order.

Real-life example:

- Two objects with same data but different key order produce same canonical JSON before hashing.

```js
toCanonicalJson({ b: 2, a: 1 });
// '{"a":1,"b":2}'
```

Why apps use it:

- Needed for stable idempotency and signature-like comparisons.

## `toSha256Hex(value)`

What it does:

- Returns SHA-256 hex digest for a string.

Real-life example:

```js
toSha256Hex("hello");
// 64-char hex digest
```

Why apps use it:

- Used for deterministic fingerprinting (for example message idempotency records).

## `createChatRealtimeService(options)`

What it does:

- Creates a generic realtime publisher facade for chat events.
- Depends on injected `realtimeEventsService` and optional event-type constants.

Returned methods:

1. `publishThreadEvent(...)`
   - Base event publisher for a thread + payload.
   - Example: publish any custom thread-level event to selected participants.
2. `publishMessageEvent(...)`
   - Emits message-created event with idempotency status.
   - Example: after storing a message, notify thread members.
3. `publishReadCursorUpdated(...)`
   - Emits read-cursor updates.
   - Example: user reads up to message #120; other clients clear unread badge.
4. `publishReactionUpdated(...)`
   - Emits message reaction summary updates.
   - Example: user adds 👍 and all viewers see updated counts.
5. `publishAttachmentUpdated(...)`
   - Emits attachment state changes.
   - Example: staged attachment becomes uploaded.
6. `emitTyping(...)`
   - Emits typing started/stopped events.
   - Example: show "Alex is typing..." in other clients.

Why apps use it:

- Keeps realtime payload shape and event naming consistent without binding to one transport implementation.

## `createChatService(options)`

What it does:

- Creates the main chat domain service.
- Uses injected repositories/services (threads, messages, participants, attachments, storage, memberships, etc).

Returned methods and practical examples:

1. `ensureWorkspaceRoom({ user, surfaceId })`
   - Ensures canonical workspace room thread exists.
   - Example: first time a user opens workspace chat, room is created/fetched.
2. `ensureDm({ user, targetPublicChatId })`
   - Ensures direct-message thread for two users.
   - Example: start a DM by entering coworker's public chat ID.
3. `listDmCandidates({ user, query })`
   - Lists users eligible for DM.
   - Example: typeahead search for "al" returns Alice.
4. `listInbox({ user, surfaceId, cursor, limit })`
   - Lists user's thread inbox with pagination.
   - Example: infinite-scroll inbox in sidebar.
5. `getThread({ user, threadId, surfaceId })`
   - Fetches one thread with access checks.
   - Example: opening thread #42 from notification.
6. `listThreadMessages({ user, threadId, surfaceId, cursor, limit })`
   - Fetches paginated messages for a thread.
   - Example: load older messages when user scrolls up.
7. `reserveThreadAttachment({ user, threadId, surfaceId, payload, requestMeta })`
   - Reserves an attachment slot before upload.
   - Example: user picks a file; server reserves attachment ID.
8. `uploadThreadAttachment({ user, threadId, surfaceId, attachmentId, payload, requestMeta })`
   - Uploads binary and finalizes attachment metadata.
   - Example: file upload completes and appears in composer.
9. `deleteThreadAttachment({ user, threadId, attachmentId, surfaceId, requestMeta })`
   - Removes staged attachment.
   - Example: user removes wrong file before sending.
10. `getAttachmentContent({ user, attachmentId, surfaceId })`
    - Returns protected attachment bytes + headers.
    - Example: authorized image download in chat.
11. `sendThreadMessage({ user, threadId, surfaceId, payload, requestMeta })`
    - Validates and stores message + attachments + idempotency.
    - Example: send text + two files in one message.
12. `markThreadRead({ user, threadId, surfaceId, payload, requestMeta })`
    - Advances read cursor.
    - Example: clears unread count after opening latest messages.
13. `addReaction({ user, threadId, surfaceId, payload, requestMeta })`
    - Adds a reaction to a message.
    - Example: react with 👍 on a teammate's message.
14. `removeReaction({ user, threadId, surfaceId, payload, requestMeta })`
    - Removes a reaction.
    - Example: user toggles off previous 👍 reaction.
15. `emitThreadTyping({ user, threadId, surfaceId, requestMeta })`
    - Handles typing throttling/state and realtime emit.
    - Example: typing indicator updates every ~1s while composing.

Why apps use it:

- This is the shared source of truth for chat behavior and validation rules.
- Fastify adapters/controllers stay thin and only translate HTTP to service calls.

## Testing Hooks

- `chatServiceTestables`
- `chatRealtimeServiceTestables`
- `canonicalJsonTestables`

These are for unit tests and should not be used as app runtime API.

## How It Is Used In Real App Flow

Example: user sends a message with an attachment.

1. Client calls reserve attachment endpoint.
2. Client uploads file.
3. Client sends message with `attachmentIds`.
4. Chat service stores message and updates thread state.
5. Realtime service emits message event.
6. Other clients invalidate/fetch and show the new message.

All core rule decisions in steps 3-5 live in this package.
