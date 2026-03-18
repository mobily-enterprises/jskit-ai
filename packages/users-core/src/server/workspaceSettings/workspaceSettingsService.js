import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { workspaceSettingsFields } from "../../shared/resources/workspaceSettingsFields.js";

const WORKSPACE_SETTINGS_FIELD_KEYS = workspaceSettingsFields.map((field) => field.key);

function createService({ workspaceSettingsRepository } = {}) {
  if (!workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspaceSettingsRepository.");
  }

  async function getWorkspaceSettings(workspace, options = {}) {
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      ...options,
      workspace
    });
    const settings = {};
    for (const field of workspaceSettingsFields) {
      settings[field.key] = settingsRecord[field.key];
    }
    const invitesEnabled = settings.invitesEnabled !== false;
    settings.invitesEnabled = invitesEnabled;
    settings.invitesAvailable = true;
    settings.invitesEffective = invitesEnabled;

    return {
      workspace: {
        id: Number(workspace.id),
        slug: String(workspace.slug || ""),
        ownerUserId: Number(workspace.ownerUserId)
      },
      settings
    };
  }

  async function updateWorkspaceSettings(workspace, payload = {}, options = {}) {
    const source = normalizeObjectInput(payload);
    const settingsPatch = pickOwnProperties(source, WORKSPACE_SETTINGS_FIELD_KEYS);

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateSettingsByWorkspaceId(workspace.id, settingsPatch, {
        ...options,
        workspace
      });
    }

    return getWorkspaceSettings(workspace, options);
  }

  return Object.freeze({
    getWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createService };
