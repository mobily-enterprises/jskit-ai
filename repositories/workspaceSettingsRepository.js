import { db } from "../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../lib/dateUtils.js";

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
  async function repoFindByWorkspaceId(workspaceId) {
    const row = await dbClient("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowNullable(row);
  }

  async function repoEnsureForWorkspaceId(workspaceId, defaults = {}) {
    const existing = await repoFindByWorkspaceId(workspaceId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    await dbClient("workspace_settings").insert({
      workspace_id: workspaceId,
      invites_enabled: Boolean(defaults.invitesEnabled),
      features_json: toDbJson(defaults.features || {}),
      policy_json: toDbJson(defaults.policy || {}),
      created_at: toMysqlDateTimeUtc(now),
      updated_at: toMysqlDateTimeUtc(now)
    });

    const row = await dbClient("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowRequired(row);
  }

  async function repoUpdateByWorkspaceId(workspaceId, patch = {}) {
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
      await dbClient("workspace_settings").where({ workspace_id: workspaceId }).update(dbPatch);
    }

    const row = await dbClient("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowRequired(row);
  }

  return {
    findByWorkspaceId: repoFindByWorkspaceId,
    ensureForWorkspaceId: repoEnsureForWorkspaceId,
    updateByWorkspaceId: repoUpdateByWorkspaceId
  };
}

const repository = createWorkspaceSettingsRepository(db);

const __testables = {
  mapWorkspaceSettingsRowRequired,
  mapWorkspaceSettingsRowNullable,
  parseJsonValue,
  createWorkspaceSettingsRepository
};

export const { findByWorkspaceId, ensureForWorkspaceId, updateByWorkspaceId } = repository;
export { __testables };
