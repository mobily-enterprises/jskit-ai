import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function requireResolvedWorkspace(workspace) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new Error("workspaceSettingsService requires a resolved workspace.");
  }

  const workspaceId = Number(workspace.id);
  if (!Number.isInteger(workspaceId) || workspaceId < 1) {
    throw new Error("workspaceSettingsService requires a resolved workspace.");
  }

  return workspace;
}

function createService({ workspacesRepository, workspaceSettingsRepository } = {}) {
  if (!workspacesRepository || !workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspacesRepository and workspaceSettingsRepository.");
  }

  async function getWorkspaceSettings(workspace, options = {}) {
    const resolvedWorkspace = requireResolvedWorkspace(workspace);
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(resolvedWorkspace.id, options);

    return {
      workspace: resolvedWorkspace,
      settings: {
        invitesEnabled: settingsRecord.invitesEnabled !== false
      }
    };
  }

  async function updateWorkspaceSettings(workspace, payload = {}, options = {}) {
    const resolvedWorkspace = requireResolvedWorkspace(workspace);
    const source = normalizeObjectInput(payload);
    const workspacePatch = pickOwnProperties(source, ["name", "avatarUrl", "color"]);
    const settingsPatch = pickOwnProperties(source, ["invitesEnabled"]);
    let nextWorkspace = resolvedWorkspace;

    if (Object.keys(workspacePatch).length > 0) {
      nextWorkspace = await workspacesRepository.updateById(resolvedWorkspace.id, workspacePatch, options);

      if (!nextWorkspace) {
        throw new Error("workspaceSettingsService could not reload the updated workspace.");
      }
    }

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateSettingsByWorkspaceId(resolvedWorkspace.id, settingsPatch, options);
    }

    return getWorkspaceSettings(nextWorkspace, options);
  }

  return Object.freeze({
    getWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createService };
