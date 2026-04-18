import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  workspaceSettingsFields,
  resolveWorkspaceSettingsFieldKeys
} from "../../shared/resources/workspaceSettingsFields.js";
import { createWorkspaceRoleCatalog, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

function createService({
  workspaceSettingsRepository,
  workspaceInvitationsEnabled = true,
  roleCatalog = null
} = {}) {
  if (!workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspaceSettingsRepository.");
  }
  const resolvedRoleCatalog = roleCatalog && typeof roleCatalog === "object" ? roleCatalog : createWorkspaceRoleCatalog();
  const invitesAvailable = workspaceInvitationsEnabled === true;

  async function getWorkspaceSettings(workspace, options = {}) {
    const settingsRecord = await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      ...options,
      workspace
    });
    const settings = {};
    for (const field of workspaceSettingsFields) {
      settings[field.key] = settingsRecord[field.key];
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
      roleCatalog: cloneWorkspaceRoleCatalog(resolvedRoleCatalog)
    };
  }

  async function updateWorkspaceSettings(workspace, payload = {}, options = {}) {
    const source = normalizeObjectInput(payload);
    const settingsPatch = pickOwnProperties(source, resolveWorkspaceSettingsFieldKeys());

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
