import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";

function toIso(value) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function mapConsoleRow(row = {}) {
  return {
    workspaceSurfacePrompt: String(row.assistant_workspace_surface_prompt || ""),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapWorkspaceRow(row = {}) {
  return {
    workspaceId: Number(row.workspace_id),
    appSurfacePrompt: String(row.assistant_app_surface_prompt || ""),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("assistantSettingsRepository requires knex.");
  }

  async function ensureConsoleSettings(options = {}) {
    const client = options?.trx || knex;
    const row = await client("console_settings").where({ id: 1 }).first();
    if (!row) {
      throw new Error("console_settings row missing.");
    }

    return mapConsoleRow(row);
  }

  async function updateConsoleSettings(patch = {}, options = {}) {
    const client = options?.trx || knex;
    const nextWorkspaceSurfacePrompt = String(patch.workspaceSurfacePrompt || "");

    await client("console_settings")
      .where({ id: 1 })
      .update({
        assistant_workspace_surface_prompt: nextWorkspaceSurfacePrompt,
        updated_at: new Date()
      });

    return ensureConsoleSettings({
      trx: client
    });
  }

  async function ensureWorkspaceSettings(workspaceId, options = {}) {
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericWorkspaceId) {
      throw new TypeError("assistantSettingsRepository.ensureWorkspaceSettings requires workspace id.");
    }

    const client = options?.trx || knex;
    const row = await client("workspace_settings").where({ workspace_id: numericWorkspaceId }).first();
    if (!row) {
      throw new Error("workspace_settings row missing.");
    }

    return mapWorkspaceRow(row);
  }

  async function updateWorkspaceSettings(workspaceId, patch = {}, options = {}) {
    const numericWorkspaceId = parsePositiveInteger(workspaceId);
    if (!numericWorkspaceId) {
      throw new TypeError("assistantSettingsRepository.updateWorkspaceSettings requires workspace id.");
    }

    const client = options?.trx || knex;
    const nextAppSurfacePrompt = String(patch.appSurfacePrompt || "");

    await ensureWorkspaceSettings(numericWorkspaceId, {
      trx: client
    });

    await client("workspace_settings")
      .where({ workspace_id: numericWorkspaceId })
      .update({
        assistant_app_surface_prompt: nextAppSurfacePrompt,
        updated_at: new Date()
      });

    return ensureWorkspaceSettings(numericWorkspaceId, {
      trx: client
    });
  }

  return Object.freeze({
    ensureConsoleSettings,
    updateConsoleSettings,
    ensureWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createRepository };
