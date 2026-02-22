import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import { normalizeClientKey, resolveClient } from "./shared.js";

function normalizePublicChatId(value) {
  const normalized = normalizeClientKey(value);
  if (!normalized) {
    return null;
  }
  return normalized.toLowerCase();
}

function mapUserSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapUserSettingsRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    publicChatId: row.public_chat_id == null ? null : String(row.public_chat_id),
    allowWorkspaceDms: Boolean(row.allow_workspace_dms),
    allowGlobalDms: Boolean(row.allow_global_dms),
    requireSharedWorkspaceForGlobalDm: Boolean(row.require_shared_workspace_for_global_dm),
    discoverableByPublicChatId: Boolean(row.discoverable_by_public_chat_id),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapUserSettingsRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapUserSettingsRowRequired(row);
}

function createUserSettingsRepository(dbClient) {
  async function repoFindByUserId(userId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      return null;
    }

    const row = await client("chat_user_settings").where({ user_id: numericUserId }).first();
    return mapUserSettingsRowNullable(row);
  }

  async function repoFindByPublicChatId(publicChatId, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedPublicChatId = normalizePublicChatId(publicChatId);
    if (!normalizedPublicChatId) {
      return null;
    }

    const row = await client("chat_user_settings").where({ public_chat_id: normalizedPublicChatId }).first();
    return mapUserSettingsRowNullable(row);
  }

  async function repoEnsureForUserId(userId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericUserId) {
      throw new TypeError("userId is required.");
    }

    const existing = await repoFindByUserId(numericUserId, options);
    if (existing) {
      return existing;
    }

    try {
      await client("chat_user_settings").insert({
        user_id: numericUserId
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("chat_user_settings").where({ user_id: numericUserId }).first();
    return mapUserSettingsRowRequired(row);
  }

  async function repoUpdateByUserId(userId, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const ensured = await repoEnsureForUserId(userId, options);
    const dbPatch = {};

    if (Object.hasOwn(patch, "publicChatId")) {
      dbPatch.public_chat_id = normalizePublicChatId(patch.publicChatId);
    }
    if (Object.hasOwn(patch, "allowWorkspaceDms")) {
      dbPatch.allow_workspace_dms = Boolean(patch.allowWorkspaceDms);
    }
    if (Object.hasOwn(patch, "allowGlobalDms")) {
      dbPatch.allow_global_dms = Boolean(patch.allowGlobalDms);
    }
    if (Object.hasOwn(patch, "requireSharedWorkspaceForGlobalDm")) {
      dbPatch.require_shared_workspace_for_global_dm = Boolean(patch.requireSharedWorkspaceForGlobalDm);
    }
    if (Object.hasOwn(patch, "discoverableByPublicChatId")) {
      dbPatch.discoverable_by_public_chat_id = Boolean(patch.discoverableByPublicChatId);
    }

    if (Object.keys(dbPatch).length < 1) {
      return ensured;
    }

    dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
    await client("chat_user_settings").where({ user_id: ensured.userId }).update(dbPatch);

    return repoFindByUserId(ensured.userId, options);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    ensureForUserId: repoEnsureForUserId,
    findByUserId: repoFindByUserId,
    findByPublicChatId: repoFindByPublicChatId,
    updateByUserId: repoUpdateByUserId,
    transaction: repoTransaction
  };
}

const repository = createUserSettingsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapUserSettingsRowRequired,
  mapUserSettingsRowNullable,
  normalizePublicChatId,
  createUserSettingsRepository
};

export const { ensureForUserId, findByUserId, findByPublicChatId, updateByUserId, transaction } = repository;

export { __testables };
