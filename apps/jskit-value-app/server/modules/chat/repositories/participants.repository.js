import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizePagination, parseJsonObject, resolveClient, stringifyJsonObject } from "./shared.js";

function mapParticipantRowRequired(row) {
  if (!row) {
    throw new TypeError("mapParticipantRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    userId: Number(row.user_id),
    participantRole: String(row.participant_role || "member"),
    status: String(row.status || "active"),
    joinedAt: toIsoString(row.joined_at),
    leftAt: row.left_at ? toIsoString(row.left_at) : null,
    removedByUserId: row.removed_by_user_id == null ? null : Number(row.removed_by_user_id),
    muteUntil: row.mute_until ? toIsoString(row.mute_until) : null,
    archivedAt: row.archived_at ? toIsoString(row.archived_at) : null,
    pinnedAt: row.pinned_at ? toIsoString(row.pinned_at) : null,
    lastDeliveredSeq: Number(row.last_delivered_seq || 0),
    lastDeliveredMessageId: row.last_delivered_message_id == null ? null : Number(row.last_delivered_message_id),
    lastReadSeq: Number(row.last_read_seq || 0),
    lastReadMessageId: row.last_read_message_id == null ? null : Number(row.last_read_message_id),
    lastReadAt: row.last_read_at ? toIsoString(row.last_read_at) : null,
    draftText: row.draft_text == null ? null : String(row.draft_text),
    draftUpdatedAt: row.draft_updated_at ? toIsoString(row.draft_updated_at) : null,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapParticipantRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapParticipantRowRequired(row);
}

function normalizeDmParticipantIds(userIds) {
  if (!Array.isArray(userIds)) {
    return [];
  }

  const normalized = Array.from(
    new Set(
      userIds.map((userId) => parsePositiveInteger(userId)).filter((userId) => Number.isInteger(userId) && userId > 0)
    )
  );
  return normalized.sort((a, b) => a - b);
}

function createParticipantsRepository(dbClient) {
  async function repoUpsertParticipants(threadId, userIds, { minUsers = 1 } = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const normalizedUserIds = normalizeDmParticipantIds(userIds);
    if (!numericThreadId || normalizedUserIds.length < Math.max(1, Number(minUsers) || 1)) {
      return [];
    }

    for (const userId of normalizedUserIds) {
      try {
        await repoInsert(
          {
            threadId: numericThreadId,
            userId,
            participantRole: "member",
            status: "active"
          },
          options
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }

        await client("chat_thread_participants")
          .where({
            thread_id: numericThreadId,
            user_id: userId
          })
          .update({
            status: "active",
            left_at: null,
            removed_by_user_id: null,
            updated_at: toMysqlDateTimeUtc(new Date())
          });
      }
    }

    return repoListByThreadId(numericThreadId, options);
  }

  async function repoInsert(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const threadId = parsePositiveInteger(payload?.threadId);
    const userId = parsePositiveInteger(payload?.userId);
    if (!threadId || !userId) {
      throw new TypeError("threadId and userId are required.");
    }

    const now = new Date();
    const [id] = await client("chat_thread_participants").insert({
      thread_id: threadId,
      user_id: userId,
      participant_role:
        String(payload?.participantRole || "")
          .trim()
          .toLowerCase() || "member",
      status:
        String(payload?.status || "")
          .trim()
          .toLowerCase() || "active",
      joined_at: toMysqlDateTimeUtc(payload?.joinedAt ? new Date(payload.joinedAt) : now),
      left_at: payload?.leftAt ? toMysqlDateTimeUtc(new Date(payload.leftAt)) : null,
      removed_by_user_id: parsePositiveInteger(payload?.removedByUserId),
      mute_until: payload?.muteUntil ? toMysqlDateTimeUtc(new Date(payload.muteUntil)) : null,
      archived_at: payload?.archivedAt ? toMysqlDateTimeUtc(new Date(payload.archivedAt)) : null,
      pinned_at: payload?.pinnedAt ? toMysqlDateTimeUtc(new Date(payload.pinnedAt)) : null,
      last_delivered_seq: Math.max(0, Number(payload?.lastDeliveredSeq || 0)),
      last_delivered_message_id: parsePositiveInteger(payload?.lastDeliveredMessageId),
      last_read_seq: Math.max(0, Number(payload?.lastReadSeq || 0)),
      last_read_message_id: parsePositiveInteger(payload?.lastReadMessageId),
      last_read_at: payload?.lastReadAt ? toMysqlDateTimeUtc(new Date(payload.lastReadAt)) : null,
      draft_text: payload?.draftText == null ? null : String(payload.draftText),
      draft_updated_at: payload?.draftUpdatedAt ? toMysqlDateTimeUtc(new Date(payload.draftUpdatedAt)) : null,
      metadata_json: stringifyJsonObject(payload?.metadata),
      created_at: toMysqlDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now),
      updated_at: toMysqlDateTimeUtc(payload?.updatedAt ? new Date(payload.updatedAt) : now)
    });

    return repoFindById(id, options);
  }

  async function repoFindById(participantId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericParticipantId = parsePositiveInteger(participantId);
    if (!numericParticipantId) {
      return null;
    }

    const row = await client("chat_thread_participants").where({ id: numericParticipantId }).first();
    return mapParticipantRowNullable(row);
  }

  async function repoListByThreadId(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return [];
    }

    const rows = await client("chat_thread_participants").where({ thread_id: numericThreadId }).orderBy("id", "asc");

    return rows.map(mapParticipantRowRequired);
  }

  async function repoFindByThreadIdAndUserId(threadId, userId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericThreadId || !numericUserId) {
      return null;
    }

    const row = await client("chat_thread_participants")
      .where({
        thread_id: numericThreadId,
        user_id: numericUserId
      })
      .first();

    return mapParticipantRowNullable(row);
  }

  async function repoListActiveUserIdsByThreadId(threadId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return [];
    }

    const rows = await client("chat_thread_participants")
      .where({
        thread_id: numericThreadId,
        status: "active"
      })
      .orderBy("id", "asc")
      .select("user_id");

    return rows.map((row) => Number(row.user_id)).filter((userId) => Number.isInteger(userId) && userId > 0);
  }

  async function repoUpsertDmParticipants(threadId, userIds, options = {}) {
    return repoUpsertParticipants(
      threadId,
      userIds,
      {
        minUsers: 2
      },
      options
    );
  }

  async function repoUpsertWorkspaceRoomParticipants(threadId, userIds, options = {}) {
    return repoUpsertParticipants(
      threadId,
      userIds,
      {
        minUsers: 1
      },
      options
    );
  }

  async function repoUpdateByThreadIdAndUserId(threadId, userId, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericThreadId || !numericUserId) {
      return null;
    }

    const dbPatch = {};
    if (Object.hasOwn(patch, "participantRole")) {
      dbPatch.participant_role =
        String(patch.participantRole || "")
          .trim()
          .toLowerCase() || "member";
    }
    if (Object.hasOwn(patch, "status")) {
      dbPatch.status =
        String(patch.status || "")
          .trim()
          .toLowerCase() || "active";
    }
    if (Object.hasOwn(patch, "leftAt")) {
      dbPatch.left_at = patch.leftAt ? toMysqlDateTimeUtc(new Date(patch.leftAt)) : null;
    }
    if (Object.hasOwn(patch, "removedByUserId")) {
      dbPatch.removed_by_user_id = parsePositiveInteger(patch.removedByUserId);
    }
    if (Object.hasOwn(patch, "muteUntil")) {
      dbPatch.mute_until = patch.muteUntil ? toMysqlDateTimeUtc(new Date(patch.muteUntil)) : null;
    }
    if (Object.hasOwn(patch, "archivedAt")) {
      dbPatch.archived_at = patch.archivedAt ? toMysqlDateTimeUtc(new Date(patch.archivedAt)) : null;
    }
    if (Object.hasOwn(patch, "pinnedAt")) {
      dbPatch.pinned_at = patch.pinnedAt ? toMysqlDateTimeUtc(new Date(patch.pinnedAt)) : null;
    }
    if (Object.hasOwn(patch, "lastDeliveredSeq")) {
      dbPatch.last_delivered_seq = Math.max(0, Number(patch.lastDeliveredSeq || 0));
    }
    if (Object.hasOwn(patch, "lastDeliveredMessageId")) {
      dbPatch.last_delivered_message_id = parsePositiveInteger(patch.lastDeliveredMessageId);
    }
    if (Object.hasOwn(patch, "lastReadSeq")) {
      dbPatch.last_read_seq = Math.max(0, Number(patch.lastReadSeq || 0));
    }
    if (Object.hasOwn(patch, "lastReadMessageId")) {
      dbPatch.last_read_message_id = parsePositiveInteger(patch.lastReadMessageId);
    }
    if (Object.hasOwn(patch, "lastReadAt")) {
      dbPatch.last_read_at = patch.lastReadAt ? toMysqlDateTimeUtc(new Date(patch.lastReadAt)) : null;
    }
    if (Object.hasOwn(patch, "draftText")) {
      dbPatch.draft_text = patch.draftText == null ? null : String(patch.draftText);
    }
    if (Object.hasOwn(patch, "draftUpdatedAt")) {
      dbPatch.draft_updated_at = patch.draftUpdatedAt ? toMysqlDateTimeUtc(new Date(patch.draftUpdatedAt)) : null;
    }
    if (Object.hasOwn(patch, "metadata")) {
      dbPatch.metadata_json = stringifyJsonObject(patch.metadata);
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await client("chat_thread_participants")
        .where({
          thread_id: numericThreadId,
          user_id: numericUserId
        })
        .update(dbPatch);
    }

    return repoFindByThreadIdAndUserId(numericThreadId, numericUserId, options);
  }

  async function repoMarkLeft(threadId, userId, patch = {}, options = {}) {
    return repoUpdateByThreadIdAndUserId(
      threadId,
      userId,
      {
        status: "left",
        leftAt: patch.leftAt || new Date(),
        metadata: patch.metadata
      },
      options
    );
  }

  async function repoMarkRemoved(threadId, userId, removedByUserId, options = {}) {
    return repoUpdateByThreadIdAndUserId(
      threadId,
      userId,
      {
        status: "removed",
        leftAt: new Date(),
        removedByUserId
      },
      options
    );
  }

  async function repoUpdateReadCursorMonotonic(threadId, userId, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericThreadId || !numericUserId) {
      return null;
    }

    const nextReadSeq = Math.max(0, Number(patch?.lastReadSeq || 0));
    if (nextReadSeq < 1) {
      return repoFindByThreadIdAndUserId(numericThreadId, numericUserId, options);
    }

    const nextReadMessageId = parsePositiveInteger(patch?.lastReadMessageId);
    const nextReadAt = patch?.lastReadAt ? toMysqlDateTimeUtc(new Date(patch.lastReadAt)) : null;
    const monotonicSeqSql = client.raw("GREATEST(last_read_seq, ?)", [nextReadSeq]);

    const dbPatch = {
      last_read_seq: monotonicSeqSql,
      updated_at: toMysqlDateTimeUtc(new Date())
    };
    if (nextReadMessageId) {
      dbPatch.last_read_message_id = client.raw("CASE WHEN ? >= last_read_seq THEN ? ELSE last_read_message_id END", [
        nextReadSeq,
        nextReadMessageId
      ]);
    }
    if (nextReadAt) {
      dbPatch.last_read_at = client.raw("CASE WHEN ? >= last_read_seq THEN ? ELSE last_read_at END", [
        nextReadSeq,
        nextReadAt
      ]);
    }

    await client("chat_thread_participants")
      .where({
        thread_id: numericThreadId,
        user_id: numericUserId
      })
      .update(dbPatch);

    return repoFindByThreadIdAndUserId(numericThreadId, numericUserId, options);
  }

  async function repoListThreadsForInboxUser(userId, filters = {}, pagination = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return [];
    }

    const paging = normalizePagination(pagination, {
      defaultPageSize: 20,
      maxPageSize: 100
    });

    let query = client("chat_thread_participants as p")
      .innerJoin("chat_threads as t", "t.id", "p.thread_id")
      .select(
        "p.*",
        "t.scope_kind",
        "t.workspace_id",
        "t.thread_kind",
        "t.last_message_id",
        "t.last_message_seq",
        "t.last_message_at"
      )
      .where("p.user_id", numericUserId);

    if (!filters?.includeInactiveParticipants) {
      query = query.andWhere("p.status", "active");
    }

    const workspaceId = parsePositiveInteger(filters.workspaceId);
    if (workspaceId) {
      query = query.andWhere("t.workspace_id", workspaceId);
    }

    const rows = await query
      .orderBy("t.last_message_at", "desc")
      .orderBy("p.id", "desc")
      .limit(paging.pageSize)
      .offset(paging.offset);

    return rows.map((row) => ({
      ...mapParticipantRowRequired(row),
      thread: {
        scopeKind: String(row.scope_kind || ""),
        workspaceId: row.workspace_id == null ? null : Number(row.workspace_id),
        threadKind: String(row.thread_kind || ""),
        lastMessageId: row.last_message_id == null ? null : Number(row.last_message_id),
        lastMessageSeq: row.last_message_seq == null ? null : Number(row.last_message_seq),
        lastMessageAt: row.last_message_at ? toIsoString(row.last_message_at) : null
      }
    }));
  }

  async function repoRepairPointersForThread(threadId, { lastMessageSeq = null } = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    if (!numericThreadId) {
      return 0;
    }

    const normalizedLastMessageSeq = parsePositiveInteger(lastMessageSeq);
    const nowValue = toMysqlDateTimeUtc(new Date());
    if (!normalizedLastMessageSeq) {
      const updated = await client("chat_thread_participants")
        .where({
          thread_id: numericThreadId
        })
        .update({
          last_read_seq: 0,
          last_delivered_seq: 0,
          last_read_message_id: null,
          last_delivered_message_id: null,
          last_read_at: null,
          updated_at: nowValue
        });

      return Number.isFinite(Number(updated)) && Number(updated) > 0 ? Number(updated) : 0;
    }

    const updated = await client("chat_thread_participants")
      .where({
        thread_id: numericThreadId
      })
      .update({
        last_read_seq: client.raw("LEAST(last_read_seq, ?)", [normalizedLastMessageSeq]),
        last_delivered_seq: client.raw("LEAST(last_delivered_seq, ?)", [normalizedLastMessageSeq]),
        last_read_message_id: client.raw(
          `CASE
             WHEN last_read_message_id IS NULL THEN NULL
             WHEN EXISTS (
               SELECT 1
               FROM chat_messages AS m
               WHERE m.id = chat_thread_participants.last_read_message_id
                 AND m.thread_id = ?
             ) THEN last_read_message_id
             ELSE NULL
           END`,
          [numericThreadId]
        ),
        last_delivered_message_id: client.raw(
          `CASE
             WHEN last_delivered_message_id IS NULL THEN NULL
             WHEN EXISTS (
               SELECT 1
               FROM chat_messages AS m
               WHERE m.id = chat_thread_participants.last_delivered_message_id
                 AND m.thread_id = ?
             ) THEN last_delivered_message_id
             ELSE NULL
           END`,
          [numericThreadId]
        ),
        updated_at: nowValue
      });

    return Number.isFinite(Number(updated)) && Number(updated) > 0 ? Number(updated) : 0;
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
    listByThreadId: repoListByThreadId,
    findByThreadIdAndUserId: repoFindByThreadIdAndUserId,
    listActiveUserIdsByThreadId: repoListActiveUserIdsByThreadId,
    upsertDmParticipants: repoUpsertDmParticipants,
    upsertWorkspaceRoomParticipants: repoUpsertWorkspaceRoomParticipants,
    updateByThreadIdAndUserId: repoUpdateByThreadIdAndUserId,
    markLeft: repoMarkLeft,
    markRemoved: repoMarkRemoved,
    updateReadCursorMonotonic: repoUpdateReadCursorMonotonic,
    listThreadsForInboxUser: repoListThreadsForInboxUser,
    repairPointersForThread: repoRepairPointersForThread,
    transaction: repoTransaction
  };
}

const repository = createParticipantsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapParticipantRowRequired,
  mapParticipantRowNullable,
  normalizeDmParticipantIds,
  createParticipantsRepository
};

export const {
  insert,
  findById,
  listByThreadId,
  findByThreadIdAndUserId,
  listActiveUserIdsByThreadId,
  upsertDmParticipants,
  upsertWorkspaceRoomParticipants,
  updateByThreadIdAndUserId,
  markLeft,
  markRemoved,
  updateReadCursorMonotonic,
  listThreadsForInboxUser,
  repairPointersForThread,
  transaction
} = repository;

export { __testables };
