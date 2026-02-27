import { toIsoString, toDatabaseDateTimeUtc } from "@jskit-ai/jskit-knex/dateUtils";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizeBatchSize, normalizeCutoffDateOrThrow } from "@jskit-ai/jskit-knex/retention";
import {
  normalizeCountRow,
  normalizePagination,
  parseJsonObject,
  resolveClient,
  stringifyJsonObject
} from "./shared.js";

function mapThreadRowRequired(row) {
  if (!row) {
    throw new TypeError("mapThreadRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    scopeKind: String(row.scope_kind || ""),
    workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
    threadKind: String(row.thread_kind || ""),
    createdByUserId: Number(row.created_by_user_id),
    title: row.title == null ? null : String(row.title),
    avatarStorageKey: row.avatar_storage_key == null ? null : String(row.avatar_storage_key),
    avatarVersion: row.avatar_version == null ? null : Number(row.avatar_version),
    scopeKey: String(row.scope_key || ""),
    dmUserLowId: row.dm_user_low_id == null ? null : Number(row.dm_user_low_id),
    dmUserHighId: row.dm_user_high_id == null ? null : Number(row.dm_user_high_id),
    participantCount: Number(row.participant_count || 0),
    nextMessageSeq: Number(row.next_message_seq || 1),
    lastMessageId: row.last_message_id == null ? null : Number(row.last_message_id),
    lastMessageSeq: row.last_message_seq == null ? null : Number(row.last_message_seq),
    lastMessageAt: row.last_message_at ? toIsoString(row.last_message_at) : null,
    lastMessagePreview: row.last_message_preview == null ? null : String(row.last_message_preview),
    encryptionMode: String(row.encryption_mode || "none"),
    metadata: parseJsonObject(row.metadata_json),
    archivedAt: row.archived_at ? toIsoString(row.archived_at) : null,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapThreadRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapThreadRowRequired(row);
}

function normalizeCanonicalDmPair(userAId, userBId) {
  const first = parsePositiveInteger(userAId);
  const second = parsePositiveInteger(userBId);
  if (!first || !second || first === second) {
    return null;
  }

  return first < second ? [first, second] : [second, first];
}

function createThreadsRepository(dbClient) {
  async function repoInsert(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const createdByUserId = parsePositiveInteger(payload?.createdByUserId);
    const scopeKey = String(payload?.scopeKey || "").trim();
    if (!createdByUserId || !scopeKey) {
      throw new TypeError("createdByUserId and scopeKey are required.");
    }

    const now = new Date();
    const [id] = await client("chat_threads").insert({
      scope_kind:
        String(payload?.scopeKind || "")
          .trim()
          .toLowerCase() || "workspace",
      workspace_id: parsePositiveInteger(payload?.workspaceId),
      thread_kind:
        String(payload?.threadKind || "")
          .trim()
          .toLowerCase() || "dm",
      created_by_user_id: createdByUserId,
      title: payload?.title == null ? null : String(payload.title),
      avatar_storage_key: payload?.avatarStorageKey == null ? null : String(payload.avatarStorageKey),
      avatar_version: parsePositiveInteger(payload?.avatarVersion),
      scope_key: scopeKey,
      dm_user_low_id: parsePositiveInteger(payload?.dmUserLowId),
      dm_user_high_id: parsePositiveInteger(payload?.dmUserHighId),
      participant_count: Math.max(0, Number(payload?.participantCount || 0)),
      next_message_seq: Math.max(1, Number(payload?.nextMessageSeq || 1)),
      last_message_id: parsePositiveInteger(payload?.lastMessageId),
      last_message_seq: parsePositiveInteger(payload?.lastMessageSeq),
      last_message_at: payload?.lastMessageAt ? toDatabaseDateTimeUtc(new Date(payload.lastMessageAt)) : null,
      last_message_preview: payload?.lastMessagePreview == null ? null : String(payload.lastMessagePreview),
      encryption_mode:
        String(payload?.encryptionMode || "")
          .trim()
          .toLowerCase() || "none",
      metadata_json: stringifyJsonObject(payload?.metadata),
      archived_at: payload?.archivedAt ? toDatabaseDateTimeUtc(new Date(payload.archivedAt)) : null,
      created_at: toDatabaseDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now),
      updated_at: toDatabaseDateTimeUtc(payload?.updatedAt ? new Date(payload.updatedAt) : now)
    });

    return repoFindById(id, options);
  }

  async function repoFindById(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return null;
    }

    const row = await client("chat_threads").where({ id: numericThreadId }).first();
    return mapThreadRowNullable(row);
  }

  async function repoFindDmByCanonicalPair({ scopeKey, userAId, userBId }, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedScopeKey = String(scopeKey || "").trim();
    const pair = normalizeCanonicalDmPair(userAId, userBId);
    if (!normalizedScopeKey || !pair) {
      return null;
    }

    const [lowUserId, highUserId] = pair;
    const row = await client("chat_threads")
      .where({
        thread_kind: "dm",
        scope_key: normalizedScopeKey,
        dm_user_low_id: lowUserId,
        dm_user_high_id: highUserId
      })
      .first();
    return mapThreadRowNullable(row);
  }

  async function repoFindWorkspaceRoomByWorkspaceId(workspaceId, filters = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericWorkspaceId) {
      return null;
    }

    const threadKind =
      String(filters?.threadKind || "")
        .trim()
        .toLowerCase() || "workspace_room";
    const scopeKey = String(filters?.scopeKey || "").trim();

    let query = client("chat_threads")
      .where({
        scope_kind: "workspace",
        workspace_id: numericWorkspaceId,
        thread_kind: threadKind
      })
      .orderBy("id", "asc");

    if (scopeKey) {
      query = query.andWhere("scope_key", scopeKey);
    }

    const row = await query.first();
    return mapThreadRowNullable(row);
  }

  async function repoListForUser(userId, filters = {}, pagination = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return [];
    }

    const paging = normalizePagination(pagination, {
      defaultPageSize: 20,
      maxPageSize: 100
    });
    const activeTombstoneThreshold = toDatabaseDateTimeUtc(new Date());

    let query = client("chat_threads as t")
      .innerJoin("chat_thread_participants as p", "p.thread_id", "t.id")
      .select(
        "t.*",
        "p.status as participant_status",
        "p.last_read_seq as participant_last_read_seq",
        "p.last_read_message_id as participant_last_read_message_id",
        "p.last_read_at as participant_last_read_at"
      )
      .where("p.user_id", numericUserId);

    if (!filters?.includeInactiveParticipants) {
      query = query.andWhere("p.status", "active");
    }

    const workspaceId = parsePositiveInteger(filters.workspaceId);
    if (workspaceId) {
      query = query.andWhere("t.workspace_id", workspaceId);
    }

    const scopeKind = String(filters.scopeKind || "")
      .trim()
      .toLowerCase();
    if (scopeKind) {
      query = query.andWhere("t.scope_kind", scopeKind);
    }

    if (!filters?.includeTombstoneOnlyEmptyThreads) {
      query = query.andWhere((builder) => {
        builder
          .whereNotNull("t.last_message_id")
          .orWhereNotExists(
            client("chat_message_idempotency_tombstones as tomb")
              .select(client.raw("1"))
              .whereRaw("tomb.thread_id = t.id")
              .andWhere("tomb.expires_at", ">", activeTombstoneThreshold)
          );
      });
    }

    const rows = await query
      .orderBy("t.last_message_at", "desc")
      .orderBy("t.id", "desc")
      .limit(paging.pageSize)
      .offset(paging.offset);

    return rows.map((row) => ({
      ...mapThreadRowRequired(row),
      participant: {
        status: String(row.participant_status || ""),
        lastReadSeq: Number(row.participant_last_read_seq || 0),
        lastReadMessageId:
          row.participant_last_read_message_id == null ? null : Number(row.participant_last_read_message_id),
        lastReadAt: row.participant_last_read_at ? toIsoString(row.participant_last_read_at) : null
      }
    }));
  }

  async function repoCountForUser(userId, filters = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return 0;
    }

    let query = client("chat_threads as t")
      .innerJoin("chat_thread_participants as p", "p.thread_id", "t.id")
      .where("p.user_id", numericUserId)
      .count({ total: "*" });

    if (!filters?.includeInactiveParticipants) {
      query = query.andWhere("p.status", "active");
    }

    const workspaceId = parsePositiveInteger(filters.workspaceId);
    if (workspaceId) {
      query = query.andWhere("t.workspace_id", workspaceId);
    }

    const scopeKind = String(filters.scopeKind || "")
      .trim()
      .toLowerCase();
    if (scopeKind) {
      query = query.andWhere("t.scope_kind", scopeKind);
    }

    const row = await query.first();
    return normalizeCountRow(row);
  }

  async function repoUpdateById(threadId, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return null;
    }

    const dbPatch = {};
    if (Object.hasOwn(patch, "title")) {
      dbPatch.title = patch.title == null ? null : String(patch.title);
    }
    if (Object.hasOwn(patch, "avatarStorageKey")) {
      dbPatch.avatar_storage_key = patch.avatarStorageKey == null ? null : String(patch.avatarStorageKey);
    }
    if (Object.hasOwn(patch, "avatarVersion")) {
      dbPatch.avatar_version = parsePositiveInteger(patch.avatarVersion);
    }
    if (Object.hasOwn(patch, "participantCount")) {
      dbPatch.participant_count = Math.max(0, Number(patch.participantCount || 0));
    }
    if (Object.hasOwn(patch, "nextMessageSeq")) {
      dbPatch.next_message_seq = Math.max(1, Number(patch.nextMessageSeq || 1));
    }
    if (Object.hasOwn(patch, "lastMessageId")) {
      dbPatch.last_message_id = parsePositiveInteger(patch.lastMessageId);
    }
    if (Object.hasOwn(patch, "lastMessageSeq")) {
      dbPatch.last_message_seq = parsePositiveInteger(patch.lastMessageSeq);
    }
    if (Object.hasOwn(patch, "lastMessageAt")) {
      dbPatch.last_message_at = patch.lastMessageAt ? toDatabaseDateTimeUtc(new Date(patch.lastMessageAt)) : null;
    }
    if (Object.hasOwn(patch, "lastMessagePreview")) {
      dbPatch.last_message_preview = patch.lastMessagePreview == null ? null : String(patch.lastMessagePreview);
    }
    if (Object.hasOwn(patch, "encryptionMode")) {
      dbPatch.encryption_mode =
        String(patch.encryptionMode || "")
          .trim()
          .toLowerCase() || "none";
    }
    if (Object.hasOwn(patch, "metadata")) {
      dbPatch.metadata_json = stringifyJsonObject(patch.metadata);
    }
    if (Object.hasOwn(patch, "archivedAt")) {
      dbPatch.archived_at = patch.archivedAt ? toDatabaseDateTimeUtc(new Date(patch.archivedAt)) : null;
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toDatabaseDateTimeUtc(new Date());
      await client("chat_threads").where({ id: numericThreadId }).update(dbPatch);
    }

    return repoFindById(numericThreadId, options);
  }

  async function repoAllocateNextMessageSequence(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return null;
    }

    let query = client("chat_threads").where({ id: numericThreadId });
    if (typeof query.forUpdate === "function") {
      query = query.forUpdate();
    }

    const row = await query.first("next_message_seq");
    if (!row) {
      return null;
    }

    const allocatedSeq = Math.max(1, Number(row.next_message_seq || 1));
    await client("chat_threads")
      .where({ id: numericThreadId })
      .update({
        next_message_seq: allocatedSeq + 1,
        updated_at: toDatabaseDateTimeUtc(new Date())
      });

    return allocatedSeq;
  }

  async function repoUpdateLastMessageCache(threadId, cachePatch = {}, options = {}) {
    return repoUpdateById(
      threadId,
      {
        lastMessageId: cachePatch.lastMessageId,
        lastMessageSeq: cachePatch.lastMessageSeq,
        lastMessageAt: cachePatch.lastMessageAt,
        lastMessagePreview: cachePatch.lastMessagePreview
      },
      options
    );
  }

  async function repoIncrementParticipantCount(threadId, delta = 1, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return null;
    }

    const incrementBy = Number.isInteger(Number(delta)) ? Number(delta) : 1;
    await client("chat_threads")
      .where({ id: numericThreadId })
      .update({
        participant_count: client.raw("GREATEST(0, participant_count + ?)", [incrementBy]),
        updated_at: toDatabaseDateTimeUtc(new Date())
      });

    return repoFindById(numericThreadId, options);
  }

  async function repoDeleteWithoutMessagesOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedCutoff = toDatabaseDateTimeUtc(normalizeCutoffDateOrThrow(cutoffDate));
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });
    const activeTombstoneThreshold = toDatabaseDateTimeUtc(new Date());

    const rows = await client("chat_threads as t")
      .select("t.id")
      .where("t.created_at", "<", normalizedCutoff)
      .whereNotExists(client("chat_messages as m").select(client.raw("1")).whereRaw("m.thread_id = t.id"))
      .whereNotExists(
        client("chat_message_idempotency_tombstones as tomb")
          .select(client.raw("1"))
          .whereRaw("tomb.thread_id = t.id")
          .andWhere("tomb.expires_at", ">", activeTombstoneThreshold)
      )
      .orderBy("t.id", "asc")
      .limit(normalizedBatchSize);

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length < 1) {
      return 0;
    }

    const deleted = await client("chat_threads").whereIn("id", ids).del();
    return normalizeCountRow({ total: deleted });
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
    findDmByCanonicalPair: repoFindDmByCanonicalPair,
    findWorkspaceRoomByWorkspaceId: repoFindWorkspaceRoomByWorkspaceId,
    listForUser: repoListForUser,
    countForUser: repoCountForUser,
    updateById: repoUpdateById,
    allocateNextMessageSequence: repoAllocateNextMessageSequence,
    updateLastMessageCache: repoUpdateLastMessageCache,
    incrementParticipantCount: repoIncrementParticipantCount,
    deleteWithoutMessagesOlderThan: repoDeleteWithoutMessagesOlderThan,
    transaction: repoTransaction
  };
}


const __testables = {
  mapThreadRowRequired,
  mapThreadRowNullable,
  normalizeCanonicalDmPair,
  createThreadsRepository
};


export { createThreadsRepository as createRepository, createThreadsRepository, __testables };
