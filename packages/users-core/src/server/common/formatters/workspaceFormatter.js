import { coerceWorkspaceColor } from "../../../shared/settings.js";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

function mapWorkspaceSummary(workspace, membership) {
  return {
    id: Number(workspace.id),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    color: coerceWorkspaceColor(workspace.color),
    avatarUrl: normalizeText(workspace.avatarUrl),
    roleId: normalizeLowerText(membership?.roleId || "member") || "member",
    isAccessible: normalizeLowerText(membership?.status || "active") === "active"
  };
}

function mapWorkspaceSettingsPublic(workspaceSettings) {
  const source = workspaceSettings && typeof workspaceSettings === "object" ? workspaceSettings : {};
  const invitesEnabled = source.invitesEnabled !== false;
  return {
    name: normalizeText(source.name),
    color: coerceWorkspaceColor(source.color),
    avatarUrl: normalizeText(source.avatarUrl),
    invitesEnabled,
    invitesAvailable: true,
    invitesEffective: invitesEnabled
  };
}

function mapMembershipSummary(membership, workspace) {
  if (!membership) {
    return null;
  }

  return {
    workspaceId: Number(workspace?.id || membership.workspaceId),
    roleId: normalizeLowerText(membership.roleId || "member") || "member",
    status: normalizeLowerText(membership.status || "active") || "active"
  };
}

export {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
};
