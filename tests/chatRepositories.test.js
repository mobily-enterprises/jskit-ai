import assert from "node:assert/strict";
import test from "node:test";
import { __testables as threadsTestables } from "../server/modules/chat/repositories/threads.repository.js";
import { __testables as messagesTestables } from "../server/modules/chat/repositories/messages.repository.js";
import { __testables as tombstonesTestables } from "../server/modules/chat/repositories/idempotencyTombstones.repository.js";
import { __testables as attachmentsTestables } from "../server/modules/chat/repositories/attachments.repository.js";

function createMessagesDbStub() {
  const state = {
    insertPayloads: [],
    whereConditions: []
  };

  const firstQueue = [
    {
      id: 1,
      thread_id: 2,
      thread_seq: 3,
      sender_user_id: 4,
      client_message_id: null,
      idempotency_payload_sha256: null,
      idempotency_payload_version: null,
      message_kind: "text",
      reply_to_message_id: null,
      text_content: "hello",
      ciphertext_blob: null,
      cipher_nonce: null,
      cipher_alg: null,
      key_ref: null,
      metadata_json: "{}",
      edited_at: null,
      deleted_at: null,
      deleted_by_user_id: null,
      sent_at: "2026-02-22T00:00:00.000Z",
      created_at: "2026-02-22T00:00:00.000Z",
      updated_at: "2026-02-22T00:00:00.000Z"
    },
    {
      id: 2,
      thread_id: 2,
      thread_seq: 4,
      sender_user_id: 4,
      client_message_id: "AbC-123",
      idempotency_payload_sha256: null,
      idempotency_payload_version: null,
      message_kind: "text",
      reply_to_message_id: null,
      text_content: "world",
      ciphertext_blob: null,
      cipher_nonce: null,
      cipher_alg: null,
      key_ref: null,
      metadata_json: "{}",
      edited_at: null,
      deleted_at: null,
      deleted_by_user_id: null,
      sent_at: "2026-02-22T00:00:00.000Z",
      created_at: "2026-02-22T00:00:00.000Z",
      updated_at: "2026-02-22T00:00:00.000Z"
    }
  ];

  function createQuery() {
    return {
      where(condition) {
        state.whereConditions.push(condition);
        return this;
      },
      first() {
        return Promise.resolve(firstQueue.shift() || null);
      },
      insert(payload) {
        state.insertPayloads.push(payload);
        return Promise.resolve([state.insertPayloads.length]);
      }
    };
  }

  function dbClient() {
    return createQuery();
  }

  return { dbClient, state };
}

function createTombstonesDbStub() {
  let idCounter = 1;
  const rows = [];
  const state = {
    updates: []
  };

  function matches(row, whereState) {
    return Object.entries(whereState).every(([key, value]) => row[key] === value);
  }

  function createQuery() {
    const whereState = {};
    return {
      where(condition) {
        Object.assign(whereState, condition || {});
        return this;
      },
      first() {
        const row = rows.find((entry) => matches(entry, whereState));
        return Promise.resolve(row ? { ...row } : undefined);
      },
      insert(payload) {
        const existing = rows.find((entry) => matches(entry, {
          thread_id: payload.thread_id,
          sender_user_id: payload.sender_user_id,
          client_message_id: payload.client_message_id
        }));
        if (existing) {
          const error = new Error("duplicate");
          error.code = "ER_DUP_ENTRY";
          throw error;
        }

        rows.push({ id: idCounter++, ...payload });
        return Promise.resolve([idCounter - 1]);
      },
      update(payload) {
        const row = rows.find((entry) => matches(entry, whereState));
        if (!row) {
          return Promise.resolve(0);
        }
        Object.assign(row, payload);
        state.updates.push(payload);
        return Promise.resolve(1);
      },
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      select() {
        return Promise.resolve(rows.filter((entry) => matches(entry, whereState)).map((entry) => ({ ...entry })));
      },
      whereIn() {
        return this;
      },
      del() {
        return Promise.resolve(0);
      }
    };
  }

  function dbClient() {
    return createQuery();
  }

  return {
    dbClient,
    rows,
    state
  };
}

function createAttachmentTransitionDbStub(currentRow) {
  const state = {
    updates: []
  };

  function createQuery() {
    return {
      where() {
        return this;
      },
      whereIn() {
        return this;
      },
      update(payload) {
        state.updates.push(payload);
        return Promise.resolve(0);
      },
      first() {
        return Promise.resolve(currentRow);
      }
    };
  }

  function dbClient() {
    return createQuery();
  }

  return {
    dbClient,
    state
  };
}

test("threads repository canonical DM lookup normalizes user order", async () => {
  const calls = [];
  const row = {
    id: 44,
    scope_kind: "global",
    workspace_id: null,
    thread_kind: "dm",
    created_by_user_id: 1,
    title: null,
    avatar_storage_key: null,
    avatar_version: null,
    scope_key: "global",
    dm_user_low_id: 3,
    dm_user_high_id: 9,
    participant_count: 2,
    next_message_seq: 1,
    last_message_id: null,
    last_message_seq: null,
    last_message_at: null,
    last_message_preview: null,
    encryption_mode: "none",
    metadata_json: "{}",
    archived_at: null,
    created_at: "2026-02-22T00:00:00.000Z",
    updated_at: "2026-02-22T00:00:00.000Z"
  };

  const dbClient = () => ({
    where(condition) {
      calls.push(condition);
      return this;
    },
    first() {
      return Promise.resolve(row);
    }
  });

  const repo = threadsTestables.createThreadsRepository(dbClient);
  const found = await repo.findDmByCanonicalPair({
    scopeKey: "global",
    userAId: 9,
    userBId: 3
  });
  assert.equal(found.id, 44);
  assert.deepEqual(calls[0], {
    thread_kind: "dm",
    scope_key: "global",
    dm_user_low_id: 3,
    dm_user_high_id: 9
  });
  assert.equal(threadsTestables.normalizeCanonicalDmPair(9, 3)[0], 3);
  assert.equal(threadsTestables.normalizeCanonicalDmPair(9, 9), null);
});

test("messages repository normalizes clientMessageId and duplicate-conflict detector keys off unique index", async () => {
  const { dbClient, state } = createMessagesDbStub();
  const repo = messagesTestables.createMessagesRepository(dbClient);

  await repo.insert({
    threadId: 2,
    threadSeq: 3,
    senderUserId: 4,
    clientMessageId: "   ",
    messageKind: "text",
    textContent: "hello"
  });
  await repo.insert({
    threadId: 2,
    threadSeq: 4,
    senderUserId: 4,
    clientMessageId: "AbC-123",
    messageKind: "text",
    textContent: "world"
  });

  assert.equal(state.insertPayloads[0].client_message_id, null);
  assert.equal(state.insertPayloads[1].client_message_id, "AbC-123");
  assert.equal(messagesTestables.normalizeClientMessageId("   "), null);
  assert.equal(messagesTestables.normalizeClientMessageId("AbC"), "AbC");

  const duplicateError = {
    code: "ER_DUP_ENTRY",
    sqlMessage: "Duplicate entry 'x' for key 'uq_chat_messages_thread_sender_client_id'"
  };
  const otherError = {
    code: "ER_DUP_ENTRY",
    sqlMessage: "Duplicate entry 'x' for key 'uq_chat_messages_thread_seq'"
  };

  assert.equal(messagesTestables.isClientMessageUniqueConflictError(duplicateError), true);
  assert.equal(messagesTestables.isClientMessageUniqueConflictError(otherError), false);
});

test("idempotency tombstones repository enforces immutable hash/version and maxes expiry on repeats", async () => {
  const { dbClient, rows, state } = createTombstonesDbStub();
  const repo = tombstonesTestables.createIdempotencyTombstonesRepository(dbClient);

  const inserted = await repo.insertForDeletedMessage({
    threadId: 7,
    senderUserId: 8,
    clientMessageId: "cm-1",
    idempotencyPayloadVersion: 1,
    idempotencyPayloadSha256: "abc123",
    expiresAt: "2026-03-01T00:00:00.000Z",
    deleteReason: "retention"
  });
  assert.equal(inserted.ok, true);
  assert.equal(inserted.created, true);
  assert.equal(rows.length, 1);

  const updated = await repo.insertForDeletedMessage({
    threadId: 7,
    senderUserId: 8,
    clientMessageId: "cm-1",
    idempotencyPayloadVersion: 1,
    idempotencyPayloadSha256: "abc123",
    expiresAt: "2026-04-01T00:00:00.000Z",
    deleteReason: "retention"
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.created, false);
  assert.equal(state.updates.length > 0, true);
  assert.equal(rows[0].expires_at, "2026-04-01 00:00:00.000");

  const mismatch = await repo.insertForDeletedMessage({
    threadId: 7,
    senderUserId: 8,
    clientMessageId: "cm-1",
    idempotencyPayloadVersion: 2,
    idempotencyPayloadSha256: "different",
    expiresAt: "2026-05-01T00:00:00.000Z"
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "immutable_mismatch");
});

test("attachments repository guards invalid status transitions", async () => {
  assert.equal(attachmentsTestables.isAttachmentStatusTransitionAllowed("reserved", "uploading"), true);
  assert.equal(attachmentsTestables.isAttachmentStatusTransitionAllowed("reserved", "attached"), false);

  const { dbClient } = createAttachmentTransitionDbStub({
    id: 11,
    thread_id: 5,
    message_id: null,
    uploaded_by_user_id: 3,
    client_attachment_id: "ca-1",
    position: null,
    attachment_kind: "file",
    status: "reserved",
    storage_driver: "fs",
    storage_key: null,
    delivery_path: null,
    preview_storage_key: null,
    preview_delivery_path: null,
    mime_type: null,
    file_name: null,
    size_bytes: null,
    sha256_hex: null,
    width: null,
    height: null,
    duration_ms: null,
    upload_expires_at: null,
    processed_at: null,
    failed_reason: null,
    metadata_json: "{}",
    created_at: "2026-02-22T00:00:00.000Z",
    updated_at: "2026-02-22T00:00:00.000Z",
    deleted_at: null
  });
  const repo = attachmentsTestables.createAttachmentsRepository(dbClient);

  await assert.rejects(
    () => repo.markUploaded(11, { storageKey: "uploads/chat/11" }),
    (error) => {
      assert.equal(error.code, "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION");
      assert.equal(error.currentStatus, "reserved");
      return true;
    }
  );
});
