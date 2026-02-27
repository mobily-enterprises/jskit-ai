import { OWNER_ROLE_ID } from "@jskit-ai/rbac-core";
import { normalizeEmail } from "@jskit-ai/access-core/utils";
import { coerceWorkspaceColor } from "@jskit-ai/workspace-console-core/workspaceColors";
import { resolveTranscriptModeFromWorkspaceSettings } from "@jskit-ai/assistant-transcripts-core";
import { resolveAssistantSystemPromptsFromWorkspaceSettings } from "@jskit-ai/assistant-core/systemPrompt";
import { mapWorkspaceAdminSummary } from "./workspaceMappers.js";

function normalizeDenyUserIds(rawUserIds) {
  if (!Array.isArray(rawUserIds)) {
    return [];
  }

  return Array.from(
    new Set(rawUserIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))
  );
}

function normalizeDenyEmails(rawEmails) {
  if (!Array.isArray(rawEmails)) {
    return [];
  }

  return Array.from(new Set(rawEmails.map((value) => normalizeEmail(value)).filter(Boolean)));
}

function extractAppSurfacePolicy(workspaceSettings) {
  const features =
    workspaceSettings?.features && typeof workspaceSettings.features === "object" ? workspaceSettings.features : {};
  const surfaceAccess =
    features.surfaceAccess && typeof features.surfaceAccess === "object" ? features.surfaceAccess : {};
  const appPolicy = surfaceAccess.app && typeof surfaceAccess.app === "object" ? surfaceAccess.app : {};

  return {
    denyUserIds: normalizeDenyUserIds(appPolicy.denyUserIds),
    denyEmails: normalizeDenyEmails(appPolicy.denyEmails)
  };
}

function mapWorkspaceSettingsResponse(workspace, workspaceSettings, options = {}) {
  const appSurfacePolicy = extractAppSurfacePolicy(workspaceSettings);
  const invitesAvailable = Boolean(options.appInvitesEnabled && options.collaborationEnabled);
  const invitesEnabled = Boolean(workspaceSettings?.invitesEnabled);
  const assistantTranscriptMode = resolveTranscriptModeFromWorkspaceSettings(workspaceSettings);
  const assistantSystemPrompts = resolveAssistantSystemPromptsFromWorkspaceSettings(workspaceSettings);
  const includeAppSurfaceDenyLists = options.includeAppSurfaceDenyLists === true;

  const settings = {
    invitesEnabled,
    invitesAvailable,
    invitesEffective: invitesAvailable && invitesEnabled,
    assistantTranscriptMode,
    assistantSystemPromptApp: assistantSystemPrompts.app
  };

  if (includeAppSurfaceDenyLists) {
    settings.appDenyEmails = appSurfacePolicy.denyEmails;
    settings.appDenyUserIds = appSurfacePolicy.denyUserIds;
  }

  return {
    workspace: mapWorkspaceAdminSummary(workspace),
    settings
  };
}

function mapWorkspaceMemberSummary(member, workspace) {
  return {
    userId: Number(member.userId),
    email: String(member.user?.email || ""),
    displayName: String(member.user?.displayName || ""),
    roleId: String(member.roleId || ""),
    status: String(member.status || "active"),
    isOwner: Number(member.userId) === Number(workspace.ownerUserId) || String(member.roleId || "") === OWNER_ROLE_ID
  };
}

function mapWorkspaceInviteSummary(invite) {
  return {
    id: Number(invite.id),
    workspaceId: Number(invite.workspaceId),
    email: String(invite.email || ""),
    roleId: String(invite.roleId || ""),
    status: String(invite.status || "pending"),
    expiresAt: invite.expiresAt,
    invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId),
    invitedByDisplayName: invite.invitedBy?.displayName || "",
    invitedByEmail: invite.invitedBy?.email || "",
    workspace: invite.workspace
      ? {
          id: Number(invite.workspace.id),
          slug: String(invite.workspace.slug || ""),
          name: String(invite.workspace.name || ""),
          color: coerceWorkspaceColor(invite.workspace.color),
          avatarUrl: invite.workspace.avatarUrl ? String(invite.workspace.avatarUrl) : ""
        }
      : null
  };
}

function mapWorkspacePayloadSummary(workspace) {
  return workspace
    ? {
        id: Number(workspace.id),
        slug: String(workspace.slug || ""),
        name: String(workspace.name || ""),
        color: coerceWorkspaceColor(workspace.color),
        avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : ""
      }
    : null;
}

export {
  mapWorkspaceSettingsResponse,
  mapWorkspaceMemberSummary,
  mapWorkspaceInviteSummary,
  mapWorkspacePayloadSummary
};
