import { db } from "../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../lib/dateUtils.js";

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
}

function parseJsonValue(value, fallback = {}) {
  if (!value) {
    return fallback;
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapWorkspaceSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceSettingsRowRequired expected a row object.");
  }

  return {
    workspaceId: Number(row.workspace_id),
    invitesEnabled: Boolean(row.invites_enabled),
    features: parseJsonValue(row.features_json),
    policy: parseJsonValue(row.policy_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapWorkspaceSettingsRowNullable(row) {
  if (!row) {
    return null;
  }

  return mapWorkspaceSettingsRowRequired(row);
}

function toDbJson(value) {
  if (value == null) {
    return JSON.stringify({});
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function createWorkspaceSettingsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoFindByWorkspaceId(workspaceId, options = {}) {
    const client = resolveClient(options);
    const row = await client("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowNullable(row);
  }

  async function repoFindByWorkspaceIds(workspaceIds, options = {}) {
    const normalizedWorkspaceIds = Array.from(
      new Set(
        (Array.isArray(workspaceIds) ? workspaceIds : [])
          .map((workspaceId) => Number(workspaceId))
          .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
      )
    );
    if (normalizedWorkspaceIds.length < 1) {
      return [];
    }

    const client = resolveClient(options);
    const rows = await client("workspace_settings").whereIn("workspace_id", normalizedWorkspaceIds);
    return (Array.isArray(rows) ? rows : []).map(mapWorkspaceSettingsRowRequired);
  }

  async function repoEnsureForWorkspaceId(workspaceId, defaults = {}, options = {}) {
    const client = resolveClient(options);
    const existing = await repoFindByWorkspaceId(workspaceId, options);
    if (existing) {
      return existing;
    }

    const now = new Date();
    try {
      await client("workspace_settings").insert({
        workspace_id: workspaceId,
        invites_enabled: Boolean(defaults.invitesEnabled),
        features_json: toDbJson(defaults.features || {}),
        policy_json: toDbJson(defaults.policy || {}),
        created_at: toMysqlDateTimeUtc(now),
        updated_at: toMysqlDateTimeUtc(now)
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowRequired(row);
  }

  async function repoUpdateByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const client = resolveClient(options);
    const dbPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch, "invitesEnabled")) {
      dbPatch.invites_enabled = Boolean(patch.invitesEnabled);
    }
    if (Object.prototype.hasOwnProperty.call(patch, "features")) {
      dbPatch.features_json = toDbJson(patch.features || {});
    }
    if (Object.prototype.hasOwnProperty.call(patch, "policy")) {
      dbPatch.policy_json = toDbJson(patch.policy || {});
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toMysqlDateTimeUtc(new Date());
      await client("workspace_settings").where({ workspace_id: workspaceId }).update(dbPatch);
    }

    const row = await client("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowRequired(row);
  }

  return {
    findByWorkspaceId: repoFindByWorkspaceId,
    findByWorkspaceIds: repoFindByWorkspaceIds,
    ensureForWorkspaceId: repoEnsureForWorkspaceId,
    updateByWorkspaceId: repoUpdateByWorkspaceId
  };
}

const repository = createWorkspaceSettingsRepository(db);

const __testables = {
  isMysqlDuplicateEntryError,
  mapWorkspaceSettingsRowRequired,
  mapWorkspaceSettingsRowNullable,
  parseJsonValue,
  createWorkspaceSettingsRepository
};

export const { findByWorkspaceId, findByWorkspaceIds, ensureForWorkspaceId, updateByWorkspaceId } = repository;
export { __testables };
