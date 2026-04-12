import {
  normalizeDbRecordId,
  normalizeRecordId,
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "../common/repositories/repositoryUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  workspaceSettingsFields,
  resolveWorkspaceSettingsFieldKeys
} from "../../shared/resources/workspaceSettingsFields.js";

function resolveWorkspaceSettingsSeed(workspace = {}, { defaultInvitesEnabled = true } = {}) {
  const source = normalizeObjectInput(workspace);
  const seed = {};
  for (const field of workspaceSettingsFields) {
    const rawValue = Object.hasOwn(source, field.key)
      ? source[field.key]
      : field.resolveDefault({
          workspace: source,
          defaultInvitesEnabled
        });
    seed[field.key] = field.normalizeOutput(rawValue, {
      workspace: source,
      defaultInvitesEnabled
    });
  }
  return seed;
}

function createRepository(knex, { defaultInvitesEnabled } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceSettingsRepository requires knex.");
  }

  function mapRow(row) {
    if (!row) {
      return null;
    }

    const settings = {
      workspaceId: normalizeDbRecordId(row.workspace_id, { fallback: "" })
    };
    for (const field of workspaceSettingsFields) {
      const rawValue = Object.hasOwn(row, field.dbColumn)
        ? row[field.dbColumn]
        : field.resolveDefault({
            defaultInvitesEnabled
          });
      settings[field.key] = field.normalizeOutput(rawValue, {
        defaultInvitesEnabled
      });
    }

    settings.createdAt = toIsoString(row.created_at);
    settings.updatedAt = toIsoString(row.updated_at);
    return settings;
  }

  async function findByWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      return null;
    }

    const row = await client("workspace_settings").where({ workspace_id: normalizedWorkspaceId }).first();
    return mapRow(row);
  }

  async function ensureForWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.ensureForWorkspaceId requires a valid workspace id.");
    }

    const seed = resolveWorkspaceSettingsSeed(options?.workspace, {
      defaultInvitesEnabled
    });
    const existing = await findByWorkspaceId(normalizedWorkspaceId, { trx: client });
    if (existing) {
      return existing;
    }

    try {
      const insertPayload = {
        workspace_id: normalizedWorkspaceId,
        created_at: nowDb(),
        updated_at: nowDb()
      };
      for (const field of workspaceSettingsFields) {
        insertPayload[field.dbColumn] = seed[field.key];
      }
      await client("workspace_settings").insert(insertPayload);
    } catch (error) {
      if (!isDuplicateEntryError(error)) {
        throw error;
      }
    }

    return findByWorkspaceId(normalizedWorkspaceId, { trx: client });
  }

  async function updateSettingsByWorkspaceId(workspaceId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedWorkspaceId = normalizeRecordId(workspaceId, { fallback: null });
    if (!normalizedWorkspaceId) {
      throw new TypeError("workspaceSettingsRepository.updateSettingsByWorkspaceId requires a valid workspace id.");
    }

    const ensured = await ensureForWorkspaceId(normalizedWorkspaceId, {
      trx: client,
      workspace: options?.workspace
    });
    const source = normalizeObjectInput(patch);
    const settingsPatch = pickOwnProperties(source, resolveWorkspaceSettingsFieldKeys());

    if (Object.keys(settingsPatch).length === 0) {
      return ensured;
    }

    const dbPatch = {
      updated_at: nowDb()
    };

    for (const field of workspaceSettingsFields) {
      if (!Object.hasOwn(settingsPatch, field.key)) {
        continue;
      }
      dbPatch[field.dbColumn] = field.normalizeInput(settingsPatch[field.key], {
        payload: source
      });
    }

    await client("workspace_settings").where({ workspace_id: normalizedWorkspaceId }).update({
      ...dbPatch
    });
    return findByWorkspaceId(normalizedWorkspaceId, { trx: client });
  }

  return Object.freeze({
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository };
