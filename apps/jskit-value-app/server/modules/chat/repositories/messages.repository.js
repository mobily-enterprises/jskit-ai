import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";
import {
  deleteRowsOlderThan,
  normalizeBatchSize,
  normalizeCutoffDateOrThrow
} from "@jskit-ai/knex-mysql-core/retention";
import {
  normalizeCountRow,
  normalizeIdList,
  normalizePagination,
  parseJsonObject,
  resolveClient,
  stringifyJsonObject
} from "./shared.js";

const CLIENT_MESSAGE_UNIQUE_INDEX_NAME = "uq_chat_messages_thread_sender_client_id";

function normalizeClientMessageId(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

function isClientMessageUniqueConflictError(error) {
  if (!isMysqlDuplicateEntryError(error)) {
    return false;
  }

  const message = String(error?.sqlMessage || error?.message || "").toLowerCase();
  return message.includes(CLIENT_MESSAGE_UNIQUE_INDEX_NAME);
}

function mapMessageRowRequired(row) {
  if (!row) {
    throw new TypeError("mapMessageRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    threadSeq: Number(row.thread_seq),
    senderUserId: Number(row.sender_user_id),
    clientMessageId: row.client_message_id == null ? null : String(row.client_message_id),
    idempotencyPayloadSha256: row.idempotency_payload_sha256 == null ? null : String(row.idempotency_payload_sha256),
    idempotencyPayloadVersion: row.idempotency_payload_version == null ? null : Number(row.idempotency_payload_version),
    messageKind: String(row.message_kind || "text"),
    replyToMessageId: row.reply_to_message_id == null ? null : Number(row.reply_to_message_id),
    textContent: row.text_content == null ? null : String(row.text_content),
    ciphertextBlob: row.ciphertext_blob == null ? null : row.ciphertext_blob,
    cipherNonce: row.cipher_nonce == null ? null : row.cipher_nonce,
    cipherAlg: row.cipher_alg == null ? null : String(row.cipher_alg),
    keyRef: row.key_ref == null ? null : String(row.key_ref),
    metadata: parseJsonObject(row.metadata_json),
    editedAt: row.edited_at ? toIsoString(row.edited_at) : null,
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : null,
    deletedByUserId: row.deleted_by_user_id == null ? null : Number(row.deleted_by_user_id),
    sentAt: toIsoString(row.sent_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapMessageRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapMessageRowRequired(row);
}

function mapRetentionCandidateRowRequired(row) {
  if (!row) {
    throw new TypeError("mapRetentionCandidateRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    senderUserId: Number(row.sender_user_id),
    clientMessageId: row.client_message_id == null ? null : String(row.client_message_id),
    idempotencyPayloadSha256: row.idempotency_payload_sha256 == null ? null : String(row.idempotency_payload_sha256),
    idempotencyPayloadVersion: row.idempotency_payload_version == null ? null : Number(row.idempotency_payload_version),
    createdAt: row.created_at ? toIsoString(row.created_at) : null
  };
}

function applyRetentionSelectionMode(query, selectionMode) {
  if (selectionMode === "tombstone-eligible-only") {
    return query.andWhere((builder) => {
      builder
        .whereNull("client_message_id")
        .orWhere((nested) =>
          nested.whereNotNull("idempotency_payload_sha256").whereNotNull("idempotency_payload_version")
        );
    });
  }

  if (selectionMode === "legacy-exception-only") {
    return query.whereNotNull("client_message_id").andWhere((builder) => {
      builder.whereNull("idempotency_payload_sha256").orWhereNull("idempotency_payload_version");
    });
  }

  return query;
}

function createMessagesRepository(dbClient) {
  async function repoInsert(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const threadId = parsePositiveInteger(payload?.threadId);
    const threadSeq = parsePositiveInteger(payload?.threadSeq);
    const senderUserId = parsePositiveInteger(payload?.senderUserId);
    if (!threadId || !threadSeq || !senderUserId) {
      throw new TypeError("threadId, threadSeq, and senderUserId are required.");
    }

    const now = new Date();
    const [id] = await client("chat_messages").insert({
      thread_id: threadId,
      thread_seq: threadSeq,
      sender_user_id: senderUserId,
      client_message_id: normalizeClientMessageId(payload?.clientMessageId),
      idempotency_payload_sha256:
        payload?.idempotencyPayloadSha256 == null ? null : String(payload.idempotencyPayloadSha256),
      idempotency_payload_version: parsePositiveInteger(payload?.idempotencyPayloadVersion),
      message_kind:
        String(payload?.messageKind || "")
          .trim()
          .toLowerCase() || "text",
      reply_to_message_id: parsePositiveInteger(payload?.replyToMessageId),
      text_content: payload?.textContent == null ? null : String(payload.textContent),
      ciphertext_blob: payload?.ciphertextBlob == null ? null : payload.ciphertextBlob,
      cipher_nonce: payload?.cipherNonce == null ? null : payload.cipherNonce,
      cipher_alg: payload?.cipherAlg == null ? null : String(payload.cipherAlg),
      key_ref: payload?.keyRef == null ? null : String(payload.keyRef),
      metadata_json: stringifyJsonObject(payload?.metadata),
      edited_at: payload?.editedAt ? toMysqlDateTimeUtc(new Date(payload.editedAt)) : null,
      deleted_at: payload?.deletedAt ? toMysqlDateTimeUtc(new Date(payload.deletedAt)) : null,
      deleted_by_user_id: parsePositiveInteger(payload?.deletedByUserId),
      sent_at: toMysqlDateTimeUtc(payload?.sentAt ? new Date(payload.sentAt) : now),
      created_at: toMysqlDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now),
      updated_at: toMysqlDateTimeUtc(payload?.updatedAt ? new Date(payload.updatedAt) : now)
    });

    return repoFindById(id, options);
  }

  async function repoFindById(messageId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return null;
    }

    const row = await client("chat_messages").where({ id: numericMessageId }).first();
    return mapMessageRowNullable(row);
  }

  async function repoFindByClientMessageId(threadId, senderUserId, clientMessageId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericSenderUserId = parsePositiveInteger(senderUserId);
    const normalizedClientMessageId = normalizeClientMessageId(clientMessageId);
    if (!numericThreadId || !numericSenderUserId || !normalizedClientMessageId) {
      return null;
    }

    const row = await client("chat_messages")
      .where({
        thread_id: numericThreadId,
        sender_user_id: numericSenderUserId,
        client_message_id: normalizedClientMessageId
      })
      .first();

    return mapMessageRowNullable(row);
  }

  async function repoListByThreadId(threadId, pagination = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return [];
    }

    const paging = normalizePagination(pagination, {
      defaultPageSize: 50,
      maxPageSize: 200
    });
    const rows = await client("chat_messages")
      .where({ thread_id: numericThreadId })
      .orderBy("thread_seq", "asc")
      .orderBy("id", "asc")
      .limit(paging.pageSize)
      .offset(paging.offset);

    return rows.map(mapMessageRowRequired);
  }

  async function repoListByThreadIdBeforeSeq(threadId, beforeSeq, limit = 50, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericBeforeSeq = parsePositiveInteger(beforeSeq);
    if (!numericThreadId || !numericBeforeSeq) {
      return [];
    }

    const normalizedLimit = Math.max(1, Math.min(200, parsePositiveInteger(limit) || 50));
    const rows = await client("chat_messages")
      .where("thread_id", numericThreadId)
      .andWhere("thread_seq", "<", numericBeforeSeq)
      .orderBy("thread_seq", "desc")
      .orderBy("id", "desc")
      .limit(normalizedLimit);

    return rows.map(mapMessageRowRequired);
  }

  async function repoUpdateById(messageId, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return null;
    }

    const dbPatch = {};
    if (Object.hasOwn(patch, "textContent")) {
      dbPatch.text_content = patch.textContent == null ? null : String(patch.textContent);
    }
    if (Object.hasOwn(patch, "metadata")) {
      dbPatch.metadata_json = stringifyJsonObject(patch.metadata);
    }
    if (Object.hasOwn(patch, "editedAt")) {
      dbPatch.edited_at = patch.editedAt ? toMysqlDateTimeUtc(new Date(patch.editedAt)) : null;
    }
    if (Object.hasOwn(patch, "deletedAt")) {
      dbPatch.deleted_at = patch.deletedAt ? toMysqlDateTimeUtc(new Date(patch.deletedAt)) : null;
    }
    if (Object.hasOwn(patch, "deletedByUserId")) {
      dbPatch.deleted_by_user_id = parsePositiveInteger(patch.deletedByUserId);
    }
    if (Object.hasOwn(patch, "replyToMessageId")) {
      dbPatch.reply_to_message_id = parsePositiveInteger(patch.replyToMessageId);
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await client("chat_messages").where({ id: numericMessageId }).update(dbPatch);
    }

    return repoFindById(numericMessageId, options);
  }

  async function repoCountByThreadId(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return 0;
    }

    const row = await client("chat_messages").where({ thread_id: numericThreadId }).count({ total: "*" }).first();
    return normalizeCountRow(row);
  }

  async function repoDeleteOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const selectionMode = String(options?.selectionMode || "all")
      .trim()
      .toLowerCase();

    return deleteRowsOlderThan({
      client: resolveClient(dbClient, options),
      tableName: "chat_messages",
      dateColumn: "created_at",
      cutoffDate,
      batchSize: normalizeBatchSize(batchSize, {
        fallback: 1000,
        max: 10_000
      }),
      applyFilters: (query) => applyRetentionSelectionMode(query, selectionMode)
    });
  }

  async function repoListRetentionCandidatesOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const selectionMode = String(options?.selectionMode || "all")
      .trim()
      .toLowerCase();
    const normalizedCutoff = toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(cutoffDate));
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });

    let query = client("chat_messages").where("created_at", "<", normalizedCutoff);
    query = applyRetentionSelectionMode(query, selectionMode);

    const rows = await query
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(normalizedBatchSize)
      .select(
        "id",
        "thread_id",
        "sender_user_id",
        "client_message_id",
        "idempotency_payload_sha256",
        "idempotency_payload_version",
        "created_at"
      );

    return rows.map(mapRetentionCandidateRowRequired);
  }

  async function repoDeleteByIds(messageIds, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedMessageIds = normalizeIdList(messageIds);
    if (normalizedMessageIds.length < 1) {
      return 0;
    }

    const deleted = await client("chat_messages").whereIn("id", normalizedMessageIds).del();
    return normalizeCountRow({ total: deleted });
  }

  async function repoFindLatestByThreadId(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return null;
    }

    const row = await client("chat_messages")
      .where({ thread_id: numericThreadId })
      .orderBy("thread_seq", "desc")
      .orderBy("id", "desc")
      .first();

    return mapMessageRowNullable(row);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insert: repoInsert,
    findById: repoFindById,
    findByClientMessageId: repoFindByClientMessageId,
    listByThreadId: repoListByThreadId,
    listByThreadIdBeforeSeq: repoListByThreadIdBeforeSeq,
    updateById: repoUpdateById,
    countByThreadId: repoCountByThreadId,
    deleteOlderThan: repoDeleteOlderThan,
    listRetentionCandidatesOlderThan: repoListRetentionCandidatesOlderThan,
    deleteByIds: repoDeleteByIds,
    findLatestByThreadId: repoFindLatestByThreadId,
    transaction: repoTransaction
  };
}

const repository = createMessagesRepository(db);

const __testables = {
  CLIENT_MESSAGE_UNIQUE_INDEX_NAME,
  isClientMessageUniqueConflictError,
  isMysqlDuplicateEntryError,
  mapRetentionCandidateRowRequired,
  mapMessageRowRequired,
  mapMessageRowNullable,
  applyRetentionSelectionMode,
  normalizeClientMessageId,
  createMessagesRepository
};

export const {
  insert,
  findById,
  findByClientMessageId,
  listByThreadId,
  listByThreadIdBeforeSeq,
  updateById,
  countByThreadId,
  deleteOlderThan,
  listRetentionCandidatesOlderThan,
  deleteByIds,
  findLatestByThreadId,
  transaction
} = repository;

export { __testables };
