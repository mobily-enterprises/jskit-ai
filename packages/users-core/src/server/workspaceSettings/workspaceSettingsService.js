import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function createService({ workspacesRepository, workspaceSettingsRepository } = {}) {
  if (!workspacesRepository || !workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspacesRepository and workspaceSettingsRepository.");
  }

  async function getWorkspaceSettings(workspace, options = {}) {
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, options);

    return {
      workspace,
      settings: {
        invitesEnabled: settingsRecord.invitesEnabled !== false
      }
    };
  }

  async function updateWorkspaceSettings(workspace, payload = {}, options = {}) {
    const source = normalizeObjectInput(payload);
    const workspacePatch = pickOwnProperties(source, ["name", "avatarUrl", "color"]);
    const settingsPatch = pickOwnProperties(source, ["invitesEnabled"]);
    let nextWorkspace = workspace;

    if (Object.keys(workspacePatch).length > 0) {
      nextWorkspace = await workspacesRepository.updateById(workspace.id, workspacePatch, options);

      if (!nextWorkspace) {
        throw new Error("workspaceSettingsService could not reload the updated workspace.");
      }
    }

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateSettingsByWorkspaceId(workspace.id, settingsPatch, options);
    }

    return getWorkspaceSettings(nextWorkspace, options);
  }

  return Object.freeze({
    getWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createService };
