import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { WORKSPACE_SETTINGS_FIELD_KEYS } from "../../shared/resources/workspaceSettingsResource.js";
import { cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

/**
 * @param {object} dependencies
 * @param {import("../types.js").WorkspaceSettingsRepository} dependencies.workspaceSettingsRepository
 * @param {boolean} dependencies.workspaceInvitationsEnabled
 * @param {import("../types.js").WorkspaceRoleCatalog} dependencies.roleCatalog
 */
function createService({ workspaceSettingsRepository, workspaceInvitationsEnabled, roleCatalog }) {
  async function readWorkspaceSettings(workspace, options = {}) {
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      ...options,
      workspace
    });
    const settings = {};
    for (const fieldKey of WORKSPACE_SETTINGS_FIELD_KEYS) {
      settings[fieldKey] = settingsRecord[fieldKey];
    }
    const invitesEnabled = workspaceInvitationsEnabled && settings.invitesEnabled !== false;
    settings.invitesEnabled = invitesEnabled;
    settings.invitesAvailable = workspaceInvitationsEnabled;
    settings.invitesEffective = invitesEnabled;

    return {
      workspace: {
        id: normalizeRecordId(workspace.id, { fallback: "" }),
        slug: String(workspace.slug || ""),
        ownerUserId: normalizeRecordId(workspace.ownerUserId, { fallback: "" })
      },
      settings,
      roleCatalog: cloneWorkspaceRoleCatalog(roleCatalog)
    };
  }

  async function getWorkspaceSettings(workspace, options = {}) {
    return returnJsonApiData(await readWorkspaceSettings(workspace, options));
  }

  /** The action's validated input; only the settings fields go to the repository. */
  async function updateWorkspaceSettings(workspace, input, options = {}) {
    const settingsPatch = pickOwnProperties(input, WORKSPACE_SETTINGS_FIELD_KEYS);

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateSettingsByWorkspaceId(workspace.id, settingsPatch, {
        ...options,
        workspace
      });
    }

    return returnJsonApiData(await readWorkspaceSettings(workspace, options));
  }

  return Object.freeze({
    getWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createService };
