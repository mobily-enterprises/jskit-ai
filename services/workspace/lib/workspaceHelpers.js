import { safePathnameFromRequest } from "../../../lib/requestUrl.js";
import { normalizeEmail } from "../../../shared/auth/utils.js";
import { resolveSurfaceFromPathname } from "../../../shared/routing/surfacePaths.js";
import { coerceWorkspaceColor } from "../../../shared/workspace/colors.js";
import { normalizeSurfaceId } from "../../../surfaces/index.js";
import { resolveWorkspaceDefaults } from "../../workspaceAdminService.js";
const DEFAULT_WORKSPACE_SETTINGS = {
  invitesEnabled: false,
  features: {},
  policy: {
    defaultMode: "fv",
    defaultTiming: "ordinary",
    defaultPaymentsPerYear: 12,
    defaultHistoryPageSize: 10
  }
};
const normalizeWorkspaceColor = coerceWorkspaceColor;

function toSlugPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildWorkspaceName(userProfile) {
  const displayName = String(userProfile?.displayName || "").trim();
  if (displayName) {
    return `${displayName} Workspace`.slice(0, 160);
  }

  const emailLocalPart = String(userProfile?.email || "").split("@")[0];
  if (emailLocalPart) {
    return `${emailLocalPart} Workspace`.slice(0, 160);
  }

  return `Workspace ${Number(userProfile?.id) || ""}`.trim();
}

function buildWorkspaceBaseSlug(userProfile) {
  const displaySlug = toSlugPart(userProfile?.displayName);
  if (displaySlug) {
    return displaySlug.slice(0, 90);
  }

  const emailLocalPart = String(userProfile?.email || "").split("@")[0];
  const emailSlug = toSlugPart(emailLocalPart);
  if (emailSlug) {
    return emailSlug.slice(0, 90);
  }

  return `user-${Number(userProfile?.id) || "workspace"}`;
}

function mapWorkspaceSummary(workspaceRow, options = {}) {
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

function mapWorkspaceSettingsPublic(workspaceSettings, options = {}) {
  if (!workspaceSettings) {
    return null;
  }

  const workspaceInvitesEnabled = Boolean(workspaceSettings.invitesEnabled);
  const appInvitesEnabled = Boolean(options.appInvitesEnabled);
  const collaborationEnabled = Boolean(options.collaborationEnabled);
  const defaults = resolveWorkspaceDefaults(workspaceSettings.policy);

  return {
    invitesEnabled: workspaceInvitesEnabled,
    invitesAvailable: appInvitesEnabled && collaborationEnabled,
    invitesEffective: appInvitesEnabled && collaborationEnabled && workspaceInvitesEnabled,
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

function resolveRequestSurfaceId(request, preferredSurfaceId = "") {
  const preferred = String(preferredSurfaceId || "").trim();
  if (preferred) {
    return normalizeSurfaceId(preferred);
  }

  const headerSurfaceId = String(request?.headers?.["x-surface-id"] || "").trim();
  if (headerSurfaceId) {
    return normalizeSurfaceId(headerSurfaceId);
  }

  const requestPathname = safePathnameFromRequest(request);
  return normalizeSurfaceId(resolveSurfaceFromPathname(requestPathname));
}

function resolveRequestedWorkspaceSlug(request) {
  const headerSlug = String(request?.headers?.["x-workspace-slug"] || "").trim();
  if (headerSlug) {
    return headerSlug;
  }

  const querySlug = String(request?.query?.workspaceSlug || "").trim();
  if (querySlug) {
    return querySlug;
  }

  const paramsSlug = String(request?.params?.workspaceSlug || "").trim();
  if (paramsSlug) {
    return paramsSlug;
  }

  return "";
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

function resolveMembershipRoleId(membershipLike) {
  return String(membershipLike?.roleId || "").trim();
}

function resolveMembershipStatus(membershipLike) {
  return String(membershipLike?.status || membershipLike?.membershipStatus || "active").trim() || "active";
}

function normalizeMembershipForAccess(membershipLike) {
  const roleId = resolveMembershipRoleId(membershipLike);
  if (!roleId) {
    return null;
  }

  const status = resolveMembershipStatus(membershipLike);
  if (status !== "active") {
    return null;
  }

  return {
    roleId,
    status
  };
}

function mapMembershipSummary(membershipLike) {
  return normalizeMembershipForAccess(membershipLike);
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value.map((permission) => String(permission || "").trim()).filter(Boolean)));
}

function createWorkspaceSettingsDefaults(invitesEnabled = false) {
  return {
    invitesEnabled: Boolean(invitesEnabled),
    features: { ...(DEFAULT_WORKSPACE_SETTINGS.features || {}) },
    policy: { ...(DEFAULT_WORKSPACE_SETTINGS.policy || {}) }
  };
}

function createMembershipIndexes(memberships) {
  const byId = new Map();
  const bySlug = new Map();

  for (const membership of memberships) {
    const workspaceId = Number(membership?.id);
    const workspaceSlug = String(membership?.slug || "").trim();

    if (Number.isInteger(workspaceId) && workspaceId > 0) {
      byId.set(workspaceId, membership);
    }
    if (workspaceSlug) {
      bySlug.set(workspaceSlug, membership);
    }
  }

  return {
    byId,
    bySlug
  };
}

export {
  toSlugPart,
  buildWorkspaceName,
  buildWorkspaceBaseSlug,
  normalizeEmail,
  mapWorkspaceSummary,
  normalizeWorkspaceColor,
  mapWorkspaceSettingsPublic,
  mapUserSettingsPublic,
  resolveRequestSurfaceId,
  resolveRequestedWorkspaceSlug,
  mapPendingInviteSummary,
  resolveMembershipRoleId,
  resolveMembershipStatus,
  normalizeMembershipForAccess,
  mapMembershipSummary,
  normalizePermissions,
  createWorkspaceSettingsDefaults,
  createMembershipIndexes
};
