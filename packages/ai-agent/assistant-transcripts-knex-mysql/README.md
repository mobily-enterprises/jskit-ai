# @jskit-ai/assistant-transcripts-knex-mysql

MySQL/Knex repositories for storing and querying AI assistant transcript data (conversations and messages).

## What this package is for

Use this package when your app needs durable transcript history for AI chats.

A transcript is the saved history of a conversation. This package handles:

- creating conversation rows
- adding message rows
- listing/searching transcript history
- retention cleanup (deleting very old data)
- SQL transactions (multiple DB changes that must succeed together)

## Key terms (plain language)

- `Knex`: a SQL query builder for Node.js.
- `repository`: a small data-access object that hides raw SQL from the rest of your app.
- `transaction`: a DB safety wrapper where all operations succeed or all are rolled back.
- `retention`: policy for how long old data is kept.

## Public API

## `createConversationsRepository(deps)`

Creates a conversations repository.

Returned methods:

- `insert(data)`
  - Creates a new conversation row.
  - Real example: user clicks "New AI chat", app inserts conversation before first message.
- `findById(conversationId)`
  - Fetches one conversation by ID.
  - Real example: open a transcript details page.
- `findByIdForWorkspace(conversationId, workspaceId)`
  - Fetches a conversation only if it belongs to a specific workspace.
  - Real example: protect cross-workspace access in multi-tenant apps.
- `findByIdForWorkspaceAndUser(conversationId, workspaceId, userId)`
  - Same as above, with user ownership/visibility filter.
  - Real example: user can only open their own private transcript.
- `updateById(conversationId, patch)`
  - Updates selected fields.
  - Real example: rename a conversation title from "Untitled" to "Quarterly Planning".
- `incrementMessageCount(conversationId, by = 1)`
  - Atomically increments message counter.
  - Real example: after saving each assistant/user message.
- `list(filters)`
  - Lists conversations using pagination/filter criteria.
  - Real example: transcripts table in admin console with page size + search.
- `count(filters)`
  - Returns total count for matching conversations.
  - Real example: render "Showing 20 of 342 transcripts".
- `deleteWithoutMessagesOlderThan(cutoffIso)`
  - Removes very old empty conversations.
  - Real example: nightly retention job deletes abandoned conversations.
- `transaction(work)`
  - Runs repository operations in one transaction.
  - Real example: create conversation + first message as one safe unit.

## `createMessagesRepository(deps)`

Creates a messages repository.

Returned methods:

- `insert(data)`
  - Writes a transcript message row.
  - Real example: persist assistant answer after model response.
- `findById(messageId)`
  - Gets a single message by ID.
  - Real example: investigate one message reported by support.
- `listByConversationId(conversationId, options)`
  - Lists messages for a conversation.
  - Real example: load chat history window.
- `listByConversationIdForWorkspace(conversationId, workspaceId, options)`
  - Lists messages with workspace guard.
  - Real example: prevent tenant data leakage.
- `countByConversationId(conversationId)`
  - Counts messages in one conversation.
  - Real example: show transcript length in UI.
- `countByConversationIdForWorkspace(conversationId, workspaceId)`
  - Count with workspace guard.
  - Real example: admin analytics per workspace.
- `exportByFilters(filters)`
  - Streams/returns export data for reporting.
  - Real example: compliance export for a date range.
- `deleteOlderThan(cutoffIso)`
  - Deletes old messages by retention policy.
  - Real example: remove messages older than 90 days.
- `transaction(work)`
  - Runs message operations atomically.
  - Real example: bulk import transcript fragments safely.

## How apps use this package (and why)

Typical flow:

1. App route receives request to start a conversation.
2. Service calls `conversations.insert`.
3. Each user/assistant turn calls `messages.insert` and `conversations.incrementMessageCount`.
4. History screen uses `conversations.list` and `messages.listByConversationId`.
5. Retention worker calls `deleteOlderThan` and `deleteWithoutMessagesOlderThan`.

Why apps use it:

- keeps SQL in one place
- gives clear tenant-safe query helpers
- makes transcript retention and export straightforward
