import { coerceWorkspaceColor } from "../../../../shared/workspace/colors.js";
import { resolveWorkspaceDefaults } from "../policies/workspacePolicyDefaults.js";
import { resolveTranscriptModeFromWorkspaceSettings } from "../../../lib/aiTranscriptMode.js";

function normalizeWorkspaceColor(value) {
  return coerceWorkspaceColor(value);
}

function mapWorkspaceMembershipSummary(workspaceRow, options = {}) {
  return {
    id: Number(workspaceRow.id),
    slug: String(workspaceRow.slug || ""),
    name: String(workspaceRow.name || ""),
    color: normalizeWorkspaceColor(workspaceRow.color),
    avatarUrl: workspaceRow.avatarUrl ? String(workspaceRow.avatarUrl) : "",
    roleId: String(workspaceRow.roleId || ""),
    isAccessible: options.isAccessible !== false
  };
}

function mapWorkspaceAdminSummary(workspace) {
  return {
    id: Number(workspace.id),
    slug: String(workspace.slug || ""),
    name: String(workspace.name || ""),
    color: normalizeWorkspaceColor(workspace.color),
    avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : "",
    ownerUserId: Number(workspace.ownerUserId),
    isPersonal: Boolean(workspace.isPersonal)
  };
}

function mapWorkspaceSettingsPublic(workspaceSettings, options = {}) {
  if (!workspaceSettings) {
    return null;
  }

  const workspaceInvitesEnabled = Boolean(workspaceSettings.invitesEnabled);
  const appInvitesEnabled = Boolean(options.appInvitesEnabled);
  const collaborationEnabled = Boolean(options.collaborationEnabled);
  const defaults = resolveWorkspaceDefaults(workspaceSettings.policy);
  const assistantTranscriptMode = resolveTranscriptModeFromWorkspaceSettings(workspaceSettings);

  return {
    invitesEnabled: workspaceInvitesEnabled,
    invitesAvailable: appInvitesEnabled && collaborationEnabled,
    invitesEffective: appInvitesEnabled && collaborationEnabled && workspaceInvitesEnabled,
    assistantTranscriptMode,
    ...defaults
  };
}

function mapUserSettingsPublic(userSettings) {
  return {
    theme: userSettings?.theme || "system",
    locale: userSettings?.locale || "en-US",
    timeZone: userSettings?.timeZone || "UTC",
    dateFormat: userSettings?.dateFormat || "system",
    numberFormat: userSettings?.numberFormat || "system",
    currencyCode: userSettings?.currencyCode || "USD",
    avatarSize: Number(userSettings?.avatarSize || 64),
    lastActiveWorkspaceId:
      userSettings?.lastActiveWorkspaceId == null ? null : Number(userSettings.lastActiveWorkspaceId)
  };
}

function mapPendingInviteSummary(invite) {
  return {
    id: Number(invite.id),
    workspaceId: Number(invite.workspaceId),
    token: String(invite.token || ""),
    workspaceSlug: String(invite.workspace?.slug || ""),
    workspaceName: String(invite.workspace?.name || ""),
    workspaceAvatarUrl: invite.workspace?.avatarUrl ? String(invite.workspace.avatarUrl) : "",
    roleId: String(invite.roleId || ""),
    status: String(invite.status || "pending"),
    expiresAt: invite.expiresAt,
    invitedByDisplayName: String(invite.invitedBy?.displayName || ""),
    invitedByEmail: String(invite.invitedBy?.email || "")
  };
}

export {
  normalizeWorkspaceColor,
  mapWorkspaceMembershipSummary,
  mapWorkspaceAdminSummary,
  mapWorkspaceSettingsPublic,
  mapUserSettingsPublic,
  mapPendingInviteSummary
};
