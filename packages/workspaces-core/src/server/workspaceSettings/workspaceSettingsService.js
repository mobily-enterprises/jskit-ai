import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  WORKSPACE_SETTINGS_FIELD_KEYS
} from "../../shared/resources/workspaceSettingsResource.js";
import { cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./workspaceSettingsRepository.js").createRepository>} dependencies.workspaceSettingsRepository
 * @param {boolean} [dependencies.workspaceInvitationsEnabled]
 * @param {ReturnType<typeof import("../../shared/roles.js").createWorkspaceRoleCatalog>} dependencies.roleCatalog
 */
function createService({ workspaceSettingsRepository, workspaceInvitationsEnabled = true, roleCatalog }) {
  const invitesAvailable = workspaceInvitationsEnabled === true;

  async function getWorkspaceSettings(workspace, options = {}) {
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      ...options,
      workspace
    });
    const settings = {};
    for (const fieldKey of WORKSPACE_SETTINGS_FIELD_KEYS) {
      settings[fieldKey] = settingsRecord[fieldKey];
    }
    const invitesEnabled = invitesAvailable && settings.invitesEnabled !== false;
    settings.invitesEnabled = invitesEnabled;
    settings.invitesAvailable = invitesAvailable;
    settings.invitesEffective = invitesAvailable && invitesEnabled;

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

/** @typedef {ReturnType<typeof createService>} WorkspaceSettingsService */

export { createService };
