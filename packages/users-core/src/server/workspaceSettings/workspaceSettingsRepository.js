import {
  parseJson,
  toDbJson,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "../common/repositories/repositoryUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { DEFAULT_WORKSPACE_SETTINGS } from "../../shared/settings.js";

function normalizeWorkspaceFeatures(features) {
  const source = normalizeObjectInput(features);
  const surfaceAccess = normalizeObjectInput(source.surfaceAccess);
  const appSurfaceAccess = normalizeObjectInput(surfaceAccess.app);

  return {
    ...source,
    surfaceAccess: {
      ...surfaceAccess,
      app: {
        ...appSurfaceAccess,
        denyEmails: Array.isArray(appSurfaceAccess.denyEmails) ? [...appSurfaceAccess.denyEmails] : [],
        denyUserIds: Array.isArray(appSurfaceAccess.denyUserIds) ? [...appSurfaceAccess.denyUserIds] : []
      }
    }
  };
}

function mapRow(row) {
  if (!row) {
    return null;
  }

  const features = normalizeWorkspaceFeatures(parseJson(row.features_json, DEFAULT_WORKSPACE_SETTINGS.features));

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

  async function updateSettingsByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const ensured = await ensureForWorkspaceId(workspaceId, {}, { trx: client });
    const source = normalizeObjectInput(patch);
    const dbPatch = {
      updated_at: nowDb()
    };

    if (Object.hasOwn(source, "invitesEnabled")) {
      dbPatch.invites_enabled = source.invitesEnabled === true;
    }
    if (Object.hasOwn(source, "appDenyEmails") || Object.hasOwn(source, "appDenyUserIds")) {
      const nextFeatures = {
        ...ensured.features,
        surfaceAccess: {
          ...ensured.features.surfaceAccess,
          app: {
            ...ensured.features.surfaceAccess.app
          }
        }
      };

      if (Object.hasOwn(source, "appDenyEmails")) {
        nextFeatures.surfaceAccess.app.denyEmails = source.appDenyEmails;
      }

      if (Object.hasOwn(source, "appDenyUserIds")) {
        nextFeatures.surfaceAccess.app.denyUserIds = source.appDenyUserIds;
      }

      dbPatch.features_json = toDbJson(nextFeatures, ensured.features);
    }

    await client("workspace_settings").where({ workspace_id: Number(workspaceId) }).update(dbPatch);
    return findByWorkspaceId(workspaceId, { trx: client });
  }

  return Object.freeze({
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository, mapRow };
