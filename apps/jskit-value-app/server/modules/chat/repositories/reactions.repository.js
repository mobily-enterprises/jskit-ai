import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizeIdList, resolveClient } from "./shared.js";

function normalizeReaction(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function mapReactionRowRequired(row) {
  if (!row) {
    throw new TypeError("mapReactionRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    messageId: Number(row.message_id),
    threadId: Number(row.thread_id),
    userId: Number(row.user_id),
    reaction: String(row.reaction || ""),
    createdAt: toIsoString(row.created_at)
  };
}

function mapReactionRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapReactionRowRequired(row);
}

function createReactionsRepository(dbClient) {
  async function findByKey(messageId, userId, reaction, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedMessageId = parsePositiveInteger(messageId);
    const normalizedUserId = parsePositiveInteger(userId);
    const normalizedReaction = normalizeReaction(reaction);
    if (!normalizedMessageId || !normalizedUserId || !normalizedReaction) {
      return null;
    }

    const row = await client("chat_message_reactions")
      .where({
        message_id: normalizedMessageId,
        user_id: normalizedUserId,
        reaction: normalizedReaction
      })
      .first();
    return mapReactionRowNullable(row);
  }

  async function repoAddReaction(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const messageId = parsePositiveInteger(payload?.messageId);
    const threadId = parsePositiveInteger(payload?.threadId);
    const userId = parsePositiveInteger(payload?.userId);
    const reaction = normalizeReaction(payload?.reaction);
    if (!messageId || !threadId || !userId || !reaction) {
      throw new TypeError("messageId, threadId, userId, and reaction are required.");
    }

    const now = new Date();
    try {
      await client("chat_message_reactions").insert({
        message_id: messageId,
        thread_id: threadId,
        user_id: userId,
        reaction,
        created_at: toMysqlDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now)
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByKey(messageId, userId, reaction, options);
  }

  async function repoRemoveReaction({ messageId, userId, reaction }, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedMessageId = parsePositiveInteger(messageId);
    const normalizedUserId = parsePositiveInteger(userId);
    const normalizedReaction = normalizeReaction(reaction);
    if (!normalizedMessageId || !normalizedUserId || !normalizedReaction) {
      return 0;
    }

    const deleted = await client("chat_message_reactions")
      .where({
        message_id: normalizedMessageId,
        user_id: normalizedUserId,
        reaction: normalizedReaction
      })
      .del();
    return Number.isFinite(Number(deleted)) && Number(deleted) > 0 ? Number(deleted) : 0;
  }

  async function repoListByMessageIds(messageIds, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedMessageIds = normalizeIdList(messageIds);
    if (normalizedMessageIds.length < 1) {
      return [];
    }

    const rows = await client("chat_message_reactions")
      .whereIn("message_id", normalizedMessageIds)
      .orderBy("message_id", "asc")
      .orderBy("id", "asc");
    return rows.map(mapReactionRowRequired);
  }

  async function repoCountByMessageId(messageId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return 0;
    }

    const row = await client("chat_message_reactions")
      .where({ message_id: numericMessageId })
      .count({ total: "*" })
      .first();
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
    addReaction: repoAddReaction,
    removeReaction: repoRemoveReaction,
    listByMessageIds: repoListByMessageIds,
    countByMessageId: repoCountByMessageId,
    transaction: repoTransaction
  };
}

const repository = createReactionsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapReactionRowRequired,
  mapReactionRowNullable,
  normalizeReaction,
  createReactionsRepository
};

export const { addReaction, removeReaction, listByMessageIds, countByMessageId, transaction } = repository;

export { __testables };
