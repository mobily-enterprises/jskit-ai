# @jskit-ai/chat-knex-mysql

MySQL/Knex repository layer for chat data (threads, participants, messages, attachments, reactions, user settings, blocks, and idempotency tombstones).

## What this package is for

Use this package when your app needs durable chat persistence in MySQL.

It provides repository factories for all core chat storage concerns so higher layers do not write raw SQL.

## Key terms (plain language)

- `thread`: a chat conversation container (DM or workspace room).
- `participant`: a user's membership/read state inside a thread.
- `idempotency tombstone`: small record that remembers a deleted message key so retries do not recreate it.
- `attachment staging`: temporary upload state before a file is attached to a message.

## Public API

## `createThreadsRepository(dbClient)`

Returned methods:

- `insert(payload)`: create thread. Example: create DM thread when two users start first conversation.
- `findById(threadId)`: get one thread. Example: open thread details panel.
- `findDmByCanonicalPair(userAId, userBId)`: find DM by user pair. Example: prevent duplicate DM threads.
- `findWorkspaceRoomByWorkspaceId(workspaceId)`: find workspace room thread. Example: open default workspace chat room.
- `listForUser(userId, filters, pagination)`: list user threads. Example: inbox sidebar listing.
- `countForUser(userId, filters)`: count threads for pagination. Example: "42 conversations" label.
- `updateById(threadId, patch)`: patch thread metadata. Example: change thread title/avatar.
- `allocateNextMessageSequence(threadId)`: reserve next monotonic message sequence. Example: assign ordered `threadSeq` during send.
- `updateLastMessageCache(threadId, cachePatch)`: update thread last-message preview pointers. Example: refresh inbox preview after send.
- `incrementParticipantCount(threadId, delta)`: adjust participant count. Example: member joins/leaves channel.
- `deleteWithoutMessagesOlderThan(cutoff, batchSize)`: retention cleanup for empty old threads. Example: nightly cleanup job.
- `transaction(work)`: run thread operations atomically.

## `createParticipantsRepository(dbClient)`

Returned methods:

- `insert(payload)`: add participant row. Example: invite user to thread.
- `findById(id)`: load participant by id. Example: admin debugging lookup.
- `listByThreadId(threadId)`: list participants. Example: member list drawer.
- `findByThreadIdAndUserId(threadId, userId)`: resolve one membership row. Example: permission check.
- `listActiveUserIdsByThreadId(threadId)`: list active users. Example: typing fanout target list.
- `upsertDmParticipants(payload)`: ensure both DM participants exist. Example: bootstrap new DM.
- `upsertWorkspaceRoomParticipants(payload)`: ensure room participants exist. Example: add workspace member to room.
- `updateByThreadIdAndUserId(threadId, userId, patch)`: update participant state. Example: mute/unmute participant metadata.
- `markLeft(threadId, userId, patch)`: mark voluntary leave. Example: user leaves group thread.
- `markRemoved(threadId, userId, removedByUserId)`: mark admin removal. Example: moderator removes user.
- `updateReadCursorMonotonic(threadId, userId, patch)`: advance read pointer only forward. Example: mark messages read.
- `listThreadsForInboxUser(userId, filters, pagination)`: inbox projection joined with thread state. Example: sidebar query.
- `repairPointersForThread(threadId, options)`: fix stale read/delivery pointers. Example: maintenance after message purge.
- `transaction(work)`: transactional participant operations.

## `createMessagesRepository(dbClient)`

Returned methods:

- `insert(payload)`: insert message row. Example: send message.
- `findById(messageId)`: load one message. Example: inspect moderated message.
- `findByClientMessageId(threadId, senderUserId, clientMessageId)`: idempotent client key lookup. Example: retry-safe send button.
- `listByThreadId(threadId, pagination)`: page messages by sequence. Example: load visible conversation window.
- `listByThreadIdBeforeSeq(threadId, beforeSeq, limit)`: fetch older messages. Example: infinite scroll up.
- `updateById(messageId, patch)`: edit/delete markers and metadata. Example: message edit flow.
- `countByThreadId(threadId)`: count thread messages. Example: analytics or pagination total.
- `deleteOlderThan(cutoff, batchSize, options)`: retention delete. Example: purge old messages.
- `listRetentionCandidatesOlderThan(cutoff, batchSize, options)`: list candidates before delete. Example: preview purge scope.
- `deleteByIds(messageIds)`: bulk delete specific rows. Example: moderation batch delete.
- `findLatestByThreadId(threadId)`: latest message lookup. Example: refresh thread preview.
- `transaction(work)`: transactional message operations.

## `createIdempotencyTombstonesRepository(dbClient)`

Returned methods:

- `insertForDeletedMessage(payload)`: insert/upsert deletion tombstone. Example: prevent retry from resurrecting deleted message.
- `findByClientMessageId(threadId, senderUserId, clientMessageId)`: find tombstone by client key.
- `deleteExpiredBatch(now, batchSize)`: remove expired tombstones. Example: nightly cleanup task.
- `listExpired(batchSize, now)`: list expired tombstones. Example: maintenance preview.
- `countActiveByExpiryBucket(startAt, endAt)`: count active tombstones in time window. Example: storage monitoring.
- `transaction(work)`: transactional tombstone operations.

## `createAttachmentsRepository(dbClient)`

Returned methods:

- `insertReserved(payload)`: reserve attachment row before upload. Example: user starts file upload.
- `findById(attachmentId)`: load attachment by id.
- `findByClientAttachmentId(threadId, senderUserId, clientAttachmentId)`: idempotent lookup for retries.
- `listByMessageId(messageId)`: attachments for one message.
- `listByMessageIds(messageIds)`: attachments for message batch.
- `listStagedByUserIdAndThreadId(userId, threadId)`: staged (not yet attached) uploads. Example: composer draft attachments.
- `markUploading(attachmentId)`: transition to uploading state.
- `markUploaded(attachmentId, patch)`: mark upload complete with storage metadata.
- `attachToMessage(attachmentId, { messageId, position })`: attach uploaded file to message.
- `markFailed(attachmentId, reason)`: mark upload failure.
- `markExpired(attachmentId)`: expire stale staged attachment.
- `markDeleted(attachmentId, patch)`: soft-delete and clear storage pointers.
- `listExpiredUnattached(now, batchSize)`: list stale unattached uploads.
- `deleteExpiredUnattachedBatch(now, batchSize)`: remove stale unattached uploads.
- `deleteDetachedOlderThan(cutoff, batchSize)`: purge long-deleted detached attachments.
- `transaction(work)`: transactional attachment operations.

## `createReactionsRepository(dbClient)`

Returned methods:

- `addReaction(payload)`: add reaction (idempotent on duplicate key). Example: user reacts with emoji.
- `removeReaction({ messageId, userId, reaction })`: remove reaction.
- `listByMessageIds(messageIds)`: list reactions for messages.
- `countByMessageId(messageId)`: reaction count per message.
- `transaction(work)`: transactional reaction operations.

## `createUserSettingsRepository(dbClient)`

Returned methods:

- `ensureForUserId(userId)`: ensure default chat settings row exists.
- `findByUserId(userId)`: load user chat settings.
- `findByPublicChatId(publicChatId)`: lookup by public chat id.
- `updateByUserId(userId, patch)`: update DM discoverability/privacy preferences.
- `transaction(work)`: transactional user-settings operations.

## `createBlocksRepository(dbClient)`

Returned methods:

- `findByUserIdAndBlockedUserId(userId, blockedUserId)`: find block relationship.
- `isBlockedEitherDirection(userAId, userBId)`: check if either user blocked the other.
- `addBlock(payload)`: create block.
- `removeBlock(userId, blockedUserId)`: remove block.
- `listBlockedUsers(userId, pagination)`: list blocked users.
- `transaction(work)`: transactional block operations.

## Shared helpers (`./repositories/shared`)

These utility functions are also exported for reuse/testing:

- `parseJsonObject(value)` and `stringifyJsonObject(value)` for safe JSON conversion.
- `normalizeCountRow(row)` for DB count normalization.
- `normalizePagination(pagination, options)` for consistent page/pageSize offsets.
- `resolveClient(dbClient, options)` for selecting transaction client vs base client.
- `normalizeIdList(values)` for deduplicated positive IDs.
- `normalizeNullableString(value)`, `normalizeNullablePositiveInteger(value)`, `normalizeNullableDate(value)`, `normalizeClientKey(value)`.

Real example:

- a custom repository extension can reuse `normalizePagination` and `resolveClient` to stay behavior-compatible.

## How apps use this package (and why)

Typical flow:

1. App creates these repositories from one Knex client.
2. Chat service layer composes repositories into domain operations.
3. HTTP adapter/controllers call chat service; they never write SQL directly.

Why apps use it:

- clean separation of persistence from business logic
- consistent retention/idempotency/state-transition handling
- safer concurrent updates through transactions and sequence allocators
