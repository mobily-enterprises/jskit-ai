import { toIsoString, toDatabaseDateTimeUtc } from "@jskit-ai/jskit-knex/dateUtils";
import { isDuplicateEntryError } from "@jskit-ai/jskit-knex/errors";
import { mapRowNullable, parseJsonValue, resolveRepoClient, toDbJson } from "@jskit-ai/jskit-knex/server";

function mapWorkspaceSettingsRowRequired(row) {
  if (!row) {
    throw new TypeError("mapWorkspaceSettingsRowRequired expected a row object.");
  }

  return {
    workspaceId: Number(row.workspace_id),
    invitesEnabled: Boolean(row.invites_enabled),
    features: parseJsonValue(row.features_json, {}, { allowNull: true }),
    policy: parseJsonValue(row.policy_json, {}, { allowNull: true }),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

const mapWorkspaceSettingsRowNullable = mapRowNullable(mapWorkspaceSettingsRowRequired);

function createWorkspaceSettingsRepository(dbClient) {
  async function repoFindByWorkspaceId(workspaceId, options = {}) {
    const client = resolveRepoClient(dbClient, options);
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

    const client = resolveRepoClient(dbClient, options);
    const rows = await client("workspace_settings").whereIn("workspace_id", normalizedWorkspaceIds);
    return (Array.isArray(rows) ? rows : []).map(mapWorkspaceSettingsRowRequired);
  }

  async function repoEnsureForWorkspaceId(workspaceId, defaults = {}, options = {}) {
    const client = resolveRepoClient(dbClient, options);
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
        created_at: toDatabaseDateTimeUtc(now),
        updated_at: toDatabaseDateTimeUtc(now)
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    const row = await client("workspace_settings").where({ workspace_id: workspaceId }).first();
    return mapWorkspaceSettingsRowRequired(row);
  }

  async function repoUpdateByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const client = resolveRepoClient(dbClient, options);
    const dbPatch = {};
    if (Object.hasOwn(patch, "invitesEnabled")) {
      dbPatch.invites_enabled = Boolean(patch.invitesEnabled);
    }
    if (Object.hasOwn(patch, "features")) {
      dbPatch.features_json = toDbJson(patch.features || {});
    }
    if (Object.hasOwn(patch, "policy")) {
      dbPatch.policy_json = toDbJson(patch.policy || {});
    }

    if (Object.keys(dbPatch).length > 0) {
      dbPatch.updated_at = toDatabaseDateTimeUtc(new Date());
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

function createRepository(dbClient) {
  if (typeof dbClient !== "function") {
    throw new TypeError("createRepository requires a dbClient function.");
  }

  return createWorkspaceSettingsRepository(dbClient);
}

const __testables = {
  isDuplicateEntryError,
  mapWorkspaceSettingsRowRequired,
  mapWorkspaceSettingsRowNullable,
  parseJsonValue,
  createWorkspaceSettingsRepository
};

export { createRepository, __testables };
