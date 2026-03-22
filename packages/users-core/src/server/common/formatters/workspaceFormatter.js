import {
  coerceWorkspaceColor,
  coerceWorkspaceSecondaryColor,
  coerceWorkspaceSurfaceColor,
  coerceWorkspaceSurfaceVariantColor
} from "../../../shared/settings.js";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

function mapWorkspaceSummary(workspace, membership) {
  const color = coerceWorkspaceColor(workspace.color);
  return {
    id: Number(workspace.id),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    color,
    secondaryColor: coerceWorkspaceSecondaryColor(workspace.secondaryColor, { color }),
    surfaceColor: coerceWorkspaceSurfaceColor(workspace.surfaceColor, { color }),
    surfaceVariantColor: coerceWorkspaceSurfaceVariantColor(workspace.surfaceVariantColor, { color }),
    avatarUrl: normalizeText(workspace.avatarUrl),
    roleId: normalizeLowerText(membership?.roleId || "member") || "member",
    isAccessible: normalizeLowerText(membership?.status || "active") === "active"
  };
}

function mapWorkspaceSettingsPublic(workspaceSettings, { workspaceInvitationsEnabled = true } = {}) {
  const source = workspaceSettings && typeof workspaceSettings === "object" ? workspaceSettings : {};
  const invitesAvailable = workspaceInvitationsEnabled === true;
  const invitesEnabled = invitesAvailable && source.invitesEnabled !== false;
  const color = coerceWorkspaceColor(source.color);
  return {
    name: normalizeText(source.name),
    color,
    secondaryColor: coerceWorkspaceSecondaryColor(source.secondaryColor, { color }),
    surfaceColor: coerceWorkspaceSurfaceColor(source.surfaceColor, { color }),
    surfaceVariantColor: coerceWorkspaceSurfaceVariantColor(source.surfaceVariantColor, { color }),
    avatarUrl: normalizeText(source.avatarUrl),
    invitesEnabled,
    invitesAvailable,
    invitesEffective: invitesAvailable && invitesEnabled
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
