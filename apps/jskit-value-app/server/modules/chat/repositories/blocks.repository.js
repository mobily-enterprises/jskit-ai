import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { isMysqlDuplicateEntryError } from "@jskit-ai/knex-mysql-core/mysqlErrors";
import { normalizePagination, resolveClient } from "./shared.js";

function mapBlockRowRequired(row) {
  if (!row) {
    throw new TypeError("mapBlockRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    blockedUserId: Number(row.blocked_user_id),
    reason: String(row.reason || ""),
    createdAt: toIsoString(row.created_at)
  };
}

function mapBlockRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapBlockRowRequired(row);
}

function createBlocksRepository(dbClient) {
  async function repoFindByUserIdAndBlockedUserId(userId, blockedUserId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    const numericBlockedUserId = parsePositiveInteger(blockedUserId);
    if (!numericUserId || !numericBlockedUserId) {
      return null;
    }

    const row = await client("chat_user_blocks")
      .where({
        user_id: numericUserId,
        blocked_user_id: numericBlockedUserId
      })
      .first();
    return mapBlockRowNullable(row);
  }

  async function repoIsBlockedEitherDirection(userAId, userBId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserAId = parsePositiveInteger(userAId);
    const numericUserBId = parsePositiveInteger(userBId);
    if (!numericUserAId || !numericUserBId) {
      return false;
    }

    const row = await client("chat_user_blocks")
      .where((builder) => {
        builder
          .where({
            user_id: numericUserAId,
            blocked_user_id: numericUserBId
          })
          .orWhere({
            user_id: numericUserBId,
            blocked_user_id: numericUserAId
          });
      })
      .count({ total: "*" })
      .first();

    const total = Number(Object.values(row || {})[0] || 0);
    return Number.isInteger(total) && total > 0;
  }

  async function repoAddBlock(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const userId = parsePositiveInteger(payload?.userId);
    const blockedUserId = parsePositiveInteger(payload?.blockedUserId);
    if (!userId || !blockedUserId) {
      throw new TypeError("userId and blockedUserId are required.");
    }
    if (userId === blockedUserId) {
      throw new TypeError("userId and blockedUserId must be different.");
    }

    const now = new Date();
    try {
      await client("chat_user_blocks").insert({
        user_id: userId,
        blocked_user_id: blockedUserId,
        reason: payload?.reason == null ? "" : String(payload.reason).trim(),
        created_at: toMysqlDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now)
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    return repoFindByUserIdAndBlockedUserId(userId, blockedUserId, options);
  }

  async function repoRemoveBlock(userId, blockedUserId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    const numericBlockedUserId = parsePositiveInteger(blockedUserId);
    if (!numericUserId || !numericBlockedUserId) {
      return 0;
    }

    const deleted = await client("chat_user_blocks")
      .where({
        user_id: numericUserId,
        blocked_user_id: numericBlockedUserId
      })
      .del();
    return Number.isFinite(Number(deleted)) && Number(deleted) > 0 ? Number(deleted) : 0;
  }

  async function repoListBlockedUsers(userId, pagination = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return [];
    }

    const paging = normalizePagination(pagination, {
      defaultPageSize: 50,
      maxPageSize: 200
    });
    const rows = await client("chat_user_blocks")
      .where({ user_id: numericUserId })
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(paging.pageSize)
      .offset(paging.offset);

    return rows.map(mapBlockRowRequired);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    findByUserIdAndBlockedUserId: repoFindByUserIdAndBlockedUserId,
    isBlockedEitherDirection: repoIsBlockedEitherDirection,
    addBlock: repoAddBlock,
    removeBlock: repoRemoveBlock,
    listBlockedUsers: repoListBlockedUsers,
    transaction: repoTransaction
  };
}

const repository = createBlocksRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapBlockRowRequired,
  mapBlockRowNullable,
  createBlocksRepository
};

export const {
  findByUserIdAndBlockedUserId,
  isBlockedEitherDirection,
  addBlock,
  removeBlock,
  listBlockedUsers,
  transaction
} = repository;

export { __testables };
