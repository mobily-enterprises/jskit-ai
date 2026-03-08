import {
  parseJson,
  toDbJson,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "./repositoryUtils.js";
import { DEFAULT_WORKSPACE_SETTINGS } from "../../shared/settings.js";

function mapRow(row) {
  if (!row) {
    return null;
  }

  const features = parseJson(row.features_json, DEFAULT_WORKSPACE_SETTINGS.features);

  return {
    workspaceId: Number(row.workspace_id),
    invitesEnabled: row.invites_enabled == null ? true : Boolean(row.invites_enabled),
    features,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceSettingsRepository requires knex.");
  }

  async function findByWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_settings").where({ workspace_id: Number(workspaceId) }).first();
    return mapRow(row);
  }

  async function ensureForWorkspaceId(workspaceId, defaults = {}, options = {}) {
    const client = options?.trx || knex;
    const numericWorkspaceId = Number(workspaceId);
    const existing = await findByWorkspaceId(numericWorkspaceId, { trx: client });
    if (existing) {
      return existing;
    }

    const source = defaults && typeof defaults === "object" ? defaults : {};
    const invitesEnabled = Object.hasOwn(source, "invitesEnabled")
      ? source.invitesEnabled === true
      : DEFAULT_WORKSPACE_SETTINGS.invitesEnabled;
    const features = Object.hasOwn(source, "features") ? source.features : DEFAULT_WORKSPACE_SETTINGS.features;

    try {
      await client("workspace_settings").insert({
        workspace_id: numericWorkspaceId,
        invites_enabled: invitesEnabled,
        features_json: toDbJson(features, DEFAULT_WORKSPACE_SETTINGS.features),
        created_at: nowDb(),
        updated_at: nowDb()
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceId(numericWorkspaceId, { trx: client });
  }

  async function updateByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const ensured = await ensureForWorkspaceId(workspaceId, {}, { trx: client });
    const source = patch && typeof patch === "object" ? patch : {};
    const dbPatch = {
      updated_at: nowDb()
    };

    if (Object.hasOwn(source, "invitesEnabled")) {
      dbPatch.invites_enabled = source.invitesEnabled === true;
    }
    if (Object.hasOwn(source, "features")) {
      dbPatch.features_json = toDbJson(source.features, ensured.features);
    }

    await client("workspace_settings").where({ workspace_id: Number(workspaceId) }).update(dbPatch);
    return findByWorkspaceId(workspaceId, { trx: client });
  }

  return Object.freeze({
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateByWorkspaceId
  });
}

export { createRepository, mapRow };
