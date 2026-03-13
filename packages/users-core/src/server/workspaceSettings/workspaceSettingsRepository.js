import {
  toIsoString,
  nowDb,
  isDuplicateEntryError
} from "../common/repositories/repositoryUtils.js";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function createRepository(knex, { defaultInvitesEnabled } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("workspaceSettingsRepository requires knex.");
  }

  async function findByWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const row = await client("workspace_settings").where({ workspace_id: Number(workspaceId) }).first();
    if (!row) {
      return null;
    }

    return {
      workspaceId: Number(row.workspace_id),
      invitesEnabled: Boolean(row.invites_enabled),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at)
    };
  }

  async function ensureForWorkspaceId(workspaceId, options = {}) {
    const client = options?.trx || knex;
    const numericWorkspaceId = Number(workspaceId);
    const existing = await findByWorkspaceId(numericWorkspaceId, { trx: client });
    if (existing) {
      return existing;
    }

    try {
      await client("workspace_settings").insert({
        workspace_id: numericWorkspaceId,
        invites_enabled: defaultInvitesEnabled === true,
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
    const ensured = await ensureForWorkspaceId(workspaceId, { trx: client });
    const source = normalizeObjectInput(patch);
    const settingsPatch = pickOwnProperties(source, ["invitesEnabled"]);

    if (Object.keys(settingsPatch).length === 0) {
      return ensured;
    }

    const dbPatch = {
      updated_at: nowDb()
    };

    if (Object.hasOwn(settingsPatch, "invitesEnabled")) {
      dbPatch.invites_enabled = settingsPatch.invitesEnabled === true;
    }

    await client("workspace_settings").where({ workspace_id: Number(workspaceId) }).update({
      ...dbPatch
    });
    return findByWorkspaceId(workspaceId, { trx: client });
  }

  return Object.freeze({
    findByWorkspaceId,
    ensureForWorkspaceId,
    updateSettingsByWorkspaceId
  });
}

export { createRepository };
