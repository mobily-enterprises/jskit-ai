import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";
import { normalizeBatchSize } from "@jskit-ai/knex-mysql-core/retention";
import { normalizeClientKey, parseJsonObject, resolveClient, stringifyJsonObject } from "./shared.js";

function mapTombstoneRowRequired(row) {
  if (!row) {
    throw new TypeError("mapTombstoneRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    senderUserId: Number(row.sender_user_id),
    clientMessageId: String(row.client_message_id || ""),
    idempotencyPayloadVersion: Number(row.idempotency_payload_version),
    idempotencyPayloadSha256: String(row.idempotency_payload_sha256 || ""),
    originalMessageId: row.original_message_id == null ? null : Number(row.original_message_id),
    deletedAt: toIsoString(row.deleted_at),
    expiresAt: toIsoString(row.expires_at),
    deleteReason: row.delete_reason == null ? null : String(row.delete_reason),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapTombstoneRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapTombstoneRowRequired(row);
}

function normalizePayloadSha256(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function compareImmutableFields(existingRow, incoming) {
  return (
    Number(existingRow.idempotency_payload_version) === Number(incoming.idempotencyPayloadVersion) &&
    String(existingRow.idempotency_payload_sha256 || "").toLowerCase() ===
      String(incoming.idempotencyPayloadSha256 || "").toLowerCase()
  );
}

function pickLaterIsoDate(existingIso, incomingDate) {
  const existingTime = new Date(existingIso).getTime();
  const incomingTime = incomingDate.getTime();
  if (!Number.isFinite(existingTime)) {
    return incomingDate;
  }
  if (!Number.isFinite(incomingTime)) {
    return null;
  }
  return incomingTime > existingTime ? incomingDate : null;
}

function createIdempotencyTombstonesRepository(dbClient) {
  function getUniqueKeyWhere(payload) {
    return {
      thread_id: payload.threadId,
      sender_user_id: payload.senderUserId,
      client_message_id: payload.clientMessageId
    };
  }

  async function findByUniqueKeyRow(client, payload) {
    return client("chat_message_idempotency_tombstones").where(getUniqueKeyWhere(payload)).first();
  }

  function normalizeInsertPayload(payload) {
    const threadId = parsePositiveInteger(payload?.threadId);
    const senderUserId = parsePositiveInteger(payload?.senderUserId);
    const clientMessageId = normalizeClientKey(payload?.clientMessageId);
    const idempotencyPayloadVersion = parsePositiveInteger(payload?.idempotencyPayloadVersion);
    const idempotencyPayloadSha256 = normalizePayloadSha256(payload?.idempotencyPayloadSha256);
    const expiresAtDate = payload?.expiresAt ? new Date(payload.expiresAt) : null;

    if (!threadId || !senderUserId || !clientMessageId) {
      throw new TypeError("threadId, senderUserId, and clientMessageId are required.");
    }

    if (!idempotencyPayloadVersion || !idempotencyPayloadSha256) {
      return {
        valid: false,
        reason: "legacy_unsupported",
        payload: null
      };
    }

    if (!(expiresAtDate instanceof Date) || Number.isNaN(expiresAtDate.getTime())) {
      throw new TypeError("expiresAt is required and must be a valid date.");
    }

    return {
      valid: true,
      reason: null,
      payload: {
        threadId,
        senderUserId,
        clientMessageId,
        idempotencyPayloadVersion,
        idempotencyPayloadSha256,
        originalMessageId: parsePositiveInteger(payload?.originalMessageId),
        deletedAt: payload?.deletedAt ? new Date(payload.deletedAt) : new Date(),
        expiresAtDate,
        deleteReason: payload?.deleteReason == null ? null : String(payload.deleteReason).trim() || null,
        metadata: payload?.metadata
      }
    };
  }

  async function repoFindByClientMessageId(threadId, senderUserId, clientMessageId, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedThreadId = parsePositiveInteger(threadId);
    const normalizedSenderUserId = parsePositiveInteger(senderUserId);
    const normalizedClientMessageId = normalizeClientKey(clientMessageId);
    if (!normalizedThreadId || !normalizedSenderUserId || !normalizedClientMessageId) {
      return null;
    }

    const row = await client("chat_message_idempotency_tombstones")
      .where({
        thread_id: normalizedThreadId,
        sender_user_id: normalizedSenderUserId,
        client_message_id: normalizedClientMessageId
      })
      .first();
    return mapTombstoneRowNullable(row);
  }

  async function repoInsertForDeletedMessage(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalized = normalizeInsertPayload(payload);
    if (!normalized.valid) {
      return {
        ok: false,
        reason: normalized.reason,
        tombstone: null
      };
    }

    const now = new Date();
    const insertPayload = {
      thread_id: normalized.payload.threadId,
      sender_user_id: normalized.payload.senderUserId,
      client_message_id: normalized.payload.clientMessageId,
      idempotency_payload_version: normalized.payload.idempotencyPayloadVersion,
      idempotency_payload_sha256: normalized.payload.idempotencyPayloadSha256,
      original_message_id: normalized.payload.originalMessageId,
      deleted_at: toMysqlDateTimeUtc(normalized.payload.deletedAt),
      expires_at: toMysqlDateTimeUtc(normalized.payload.expiresAtDate),
      delete_reason: normalized.payload.deleteReason,
      metadata_json: stringifyJsonObject(normalized.payload.metadata),
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    };

    const existingRow = await findByUniqueKeyRow(client, normalized.payload);
    if (existingRow) {
      if (!compareImmutableFields(existingRow, normalized.payload)) {
        return {
          ok: false,
          reason: "immutable_mismatch",
          tombstone: mapTombstoneRowRequired(existingRow)
        };
      }

      const updatePatch = {};
      const laterExpiresAt = pickLaterIsoDate(existingRow.expires_at, normalized.payload.expiresAtDate);
      if (laterExpiresAt) {
        updatePatch.expires_at = toMysqlDateTimeUtc(laterExpiresAt);
      }
      if (
        normalized.payload.deleteReason &&
        normalized.payload.deleteReason !== String(existingRow.delete_reason || "")
      ) {
        updatePatch.delete_reason = normalized.payload.deleteReason;
      }
      if (Object.keys(updatePatch).length > 0) {
        updatePatch.updated_at = toMysqlDateTimeUtc(new Date());
        await client("chat_message_idempotency_tombstones")
          .where(getUniqueKeyWhere(normalized.payload))
          .update(updatePatch);
      }

      const mergedRow = await findByUniqueKeyRow(client, normalized.payload);
      return {
        ok: true,
        created: false,
        tombstone: mapTombstoneRowRequired(mergedRow)
      };
    }

    try {
      await client("chat_message_idempotency_tombstones").insert(insertPayload);
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      const racedRow = await findByUniqueKeyRow(client, normalized.payload);
      if (!racedRow) {
        throw error;
      }
      if (!compareImmutableFields(racedRow, normalized.payload)) {
        return {
          ok: false,
          reason: "immutable_mismatch",
          tombstone: mapTombstoneRowRequired(racedRow)
        };
      }

      return {
        ok: true,
        created: false,
        tombstone: mapTombstoneRowRequired(racedRow)
      };
    }

    const row = await findByUniqueKeyRow(client, normalized.payload);
    return {
      ok: true,
      created: true,
      tombstone: mapTombstoneRowRequired(row)
    };
  }

  async function repoListExpired(batchSize = 1000, now = new Date(), options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });
    const threshold = toMysqlDateTimeUtc(now);
    const rows = await client("chat_message_idempotency_tombstones")
      .where("expires_at", "<=", threshold)
      .orderBy("expires_at", "asc")
      .orderBy("id", "asc")
      .limit(normalizedBatchSize);

    return rows.map(mapTombstoneRowRequired);
  }

  async function repoDeleteExpiredBatch(now = new Date(), batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });
    const threshold = toMysqlDateTimeUtc(now);
    const rows = await client("chat_message_idempotency_tombstones")
      .where("expires_at", "<=", threshold)
      .orderBy("expires_at", "asc")
      .orderBy("id", "asc")
      .limit(normalizedBatchSize)
      .select("id");

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length < 1) {
      return 0;
    }

    const deleted = await client("chat_message_idempotency_tombstones").whereIn("id", ids).del();
    return Number.isFinite(Number(deleted)) && Number(deleted) > 0 ? Number(deleted) : 0;
  }

  async function repoCountActiveByExpiryBucket(startAt, endAt, options = {}) {
    const client = resolveClient(dbClient, options);
    const start = startAt ? toMysqlDateTimeUtc(new Date(startAt)) : null;
    const end = endAt ? toMysqlDateTimeUtc(new Date(endAt)) : null;

    let query = client("chat_message_idempotency_tombstones").count({ total: "*" });
    if (start) {
      query = query.where("expires_at", ">=", start);
    }
    if (end) {
      query = query.andWhere("expires_at", "<", end);
    }

    const row = await query.first();
    const total = Number(Object.values(row || {})[0] || 0);
    return Number.isInteger(total) && total >= 0 ? total : 0;
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insertForDeletedMessage: repoInsertForDeletedMessage,
    findByClientMessageId: repoFindByClientMessageId,
    deleteExpiredBatch: repoDeleteExpiredBatch,
    listExpired: repoListExpired,
    countActiveByExpiryBucket: repoCountActiveByExpiryBucket,
    transaction: repoTransaction
  };
}


const __testables = {
  compareImmutableFields,
  isMysqlDuplicateEntryError,
  mapTombstoneRowRequired,
  mapTombstoneRowNullable,
  normalizePayloadSha256,
  pickLaterIsoDate,
  createIdempotencyTombstonesRepository
};


export { createIdempotencyTombstonesRepository as createRepository, createIdempotencyTombstonesRepository, __testables };
