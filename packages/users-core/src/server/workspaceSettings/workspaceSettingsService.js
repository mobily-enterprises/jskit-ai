import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { createAuthorizedService } from "@jskit-ai/kernel/server/runtime";

function createService({ workspacesRepository, workspaceSettingsRepository } = {}) {
  if (!workspacesRepository || !workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspacesRepository and workspaceSettingsRepository.");
  }

  const servicePermissions = Object.freeze({
    getWorkspaceSettings: Object.freeze({
      require: "any",
      permissions: Object.freeze(["workspace.settings.view", "workspace.settings.update"])
    }),
    updateWorkspaceSettings: Object.freeze({
      require: "all",
      permissions: Object.freeze(["workspace.settings.update"])
    })
  });

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
    }

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateSettingsByWorkspaceId(workspace.id, settingsPatch, options);
    }

    return getWorkspaceSettings(nextWorkspace, options);
  }

  return createAuthorizedService(
    {
      getWorkspaceSettings,
      updateWorkspaceSettings
    },
    servicePermissions
  );
}

export { createService };
