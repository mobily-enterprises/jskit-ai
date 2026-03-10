import { coerceWorkspaceColor } from "../../shared/settings.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLowerText(value);
}

function normalizeUserProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const id = Number(source.id);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  return {
    id,
    email: normalizeEmail(source.email),
    displayName: normalizeText(source.displayName) || normalizeEmail(source.email) || `User ${id}`,
    authProvider: normalizeLowerText(source.authProvider),
    authProviderUserId: normalizeText(source.authProviderUserId),
    avatarStorageKey: source.avatarStorageKey ? normalizeText(source.avatarStorageKey) : null,
    avatarVersion: source.avatarVersion == null ? null : String(source.avatarVersion)
  };
}

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
  return {
    invitesEnabled: source.invitesEnabled !== false,
    invitesAvailable: true,
    invitesEffective: source.invitesEnabled !== false
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
  mapWorkspaceSummary,
  normalizeEmail,
  normalizeLowerText,
  normalizeText,
  normalizeUserProfile
};
