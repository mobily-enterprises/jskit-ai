import { AppError } from "../lib/errors.js";
import { safePathnameFromRequest } from "../lib/requestUrl.js";
import { OWNER_ROLE_ID, resolveRolePermissions } from "../lib/rbacManifest.js";
import { resolveSurfaceFromPathname } from "../shared/routing/surfacePaths.js";
import { normalizeSurfaceId, resolveSurfaceById } from "../surfaces/index.js";
import { resolveWorkspaceDefaults } from "./workspaceAdminService.js";

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
const DEFAULT_WORKSPACE_COLOR = "#0F6B54";
const WORKSPACE_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

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

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
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

function normalizeWorkspaceColor(value) {
  const normalized = String(value || "").trim();
  if (WORKSPACE_COLOR_PATTERN.test(normalized)) {
    return normalized.toUpperCase();
  }

  return DEFAULT_WORKSPACE_COLOR;
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
    lastActiveWorkspaceId: userSettings?.lastActiveWorkspaceId == null ? null : Number(userSettings.lastActiveWorkspaceId)
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

  return Array.from(
    new Set(
      value
        .map((permission) => String(permission || "").trim())
        .filter(Boolean)
    )
  );
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

function createWorkspaceService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository,
  workspaceInvitesRepository,
  userSettingsRepository,
  userAvatarService
}) {
  if (!workspacesRepository || !workspaceMembershipsRepository || !workspaceSettingsRepository || !userSettingsRepository) {
    throw new Error("workspace service repositories are required.");
  }

  async function ensureUniqueWorkspaceSlug(baseSlug) {
    let candidate = toSlugPart(baseSlug) || "workspace";
    let suffix = 1;

    while (suffix < 10000) {
      const existing = await workspacesRepository.findBySlug(candidate);
      if (!existing) {
        return candidate;
      }
      suffix += 1;
      candidate = `${toSlugPart(baseSlug) || "workspace"}-${suffix}`;
    }

    throw new AppError(500, "Unable to generate a unique workspace slug.");
  }

  async function ensureWorkspaceSettingsForWorkspace(workspaceId) {
    return workspaceSettingsRepository.ensureForWorkspaceId(
      workspaceId,
      createWorkspaceSettingsDefaults(Boolean(appConfig.features.workspaceInvites))
    );
  }

  async function ensurePersonalWorkspaceForUser(userProfile) {
    const userId = Number(userProfile?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(400, "Cannot ensure personal workspace without a valid user id.");
    }

    const existingWorkspace = await workspacesRepository.findPersonalByOwnerUserId(userId);
    const workspace =
      existingWorkspace ||
      (await workspacesRepository.insert({
        slug: await ensureUniqueWorkspaceSlug(buildWorkspaceBaseSlug(userProfile)),
        name: buildWorkspaceName(userProfile),
        ownerUserId: userId,
        isPersonal: true,
        avatarUrl: ""
      }));

    await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, userId);
    await ensureWorkspaceSettingsForWorkspace(workspace.id);

    const userSettings = await userSettingsRepository.ensureForUserId(userId);
    if (!userSettings.lastActiveWorkspaceId) {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, workspace.id);
    }

    return workspace;
  }

  async function listMembershipWorkspacesForUser(userId) {
    return workspacesRepository.listByUserId(userId);
  }

  function resolvePermissions(roleId) {
    const normalizedRoleId = String(roleId || "").trim().toLowerCase();
    if (!normalizedRoleId) {
      return [];
    }
    if (normalizedRoleId === OWNER_ROLE_ID) {
      return ["*"];
    }

    return resolveRolePermissions(rbacManifest, normalizedRoleId);
  }

  async function evaluateWorkspaceAccess({ user, surfaceId, workspace, membership, workspaceSettingsCache }) {
    const workspaceId = Number(workspace?.id);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      return {
        allowed: false,
        reason: "workspace_required",
        permissions: [],
        workspaceSettings: null
      };
    }

    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    const surface = resolveSurfaceById(normalizedSurfaceId);
    const effectiveMembership = normalizeMembershipForAccess(membership);

    let workspaceSettings = workspaceSettingsCache.get(workspaceId);
    if (!workspaceSettings) {
      workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspaceId);
      workspaceSettingsCache.set(workspaceId, workspaceSettings);
    }

    const decision = await Promise.resolve(
      surface.canAccessWorkspace({
        user,
        workspace,
        membership: effectiveMembership,
        workspaceSettings,
        appConfig,
        resolvePermissions
      })
    );

    return {
      allowed: Boolean(decision?.allowed),
      reason: String(decision?.reason || "forbidden"),
      permissions: normalizePermissions(decision?.permissions),
      workspaceSettings
    };
  }

  async function resolveWorkspaceCandidateBySlug({ workspaceSlug, membershipIndex, userId }) {
    const slug = String(workspaceSlug || "").trim();
    if (!slug) {
      return null;
    }

    const membershipWorkspace = membershipIndex.bySlug.get(slug);
    if (membershipWorkspace) {
      return {
        workspace: membershipWorkspace,
        membership: membershipWorkspace
      };
    }

    const workspace = await workspacesRepository.findBySlug(slug);
    if (!workspace) {
      return null;
    }

    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, userId);
    return {
      workspace,
      membership
    };
  }

  async function resolveWorkspaceCandidateById({ workspaceId, membershipIndex, userId }) {
    const numericWorkspaceId = Number(workspaceId);
    if (!Number.isInteger(numericWorkspaceId) || numericWorkspaceId < 1) {
      return null;
    }

    const membershipWorkspace = membershipIndex.byId.get(numericWorkspaceId);
    if (membershipWorkspace) {
      return {
        workspace: membershipWorkspace,
        membership: membershipWorkspace
      };
    }

    const workspace = await workspacesRepository.findById(numericWorkspaceId);
    if (!workspace) {
      return null;
    }

    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(numericWorkspaceId, userId);
    return {
      workspace,
      membership
    };
  }

  async function resolveWorkspaceCandidateBySelector({ selector, membershipIndex, userId }) {
    const rawSelector = String(selector || "").trim();
    if (!rawSelector) {
      return null;
    }

    const bySlug = await resolveWorkspaceCandidateBySlug({
      workspaceSlug: rawSelector,
      membershipIndex,
      userId
    });
    if (bySlug) {
      return bySlug;
    }

    return resolveWorkspaceCandidateById({
      workspaceId: rawSelector,
      membershipIndex,
      userId
    });
  }

  async function listPendingInvitesForUser(userProfile) {
    if (!workspaceInvitesRepository || typeof workspaceInvitesRepository.listPendingByEmail !== "function") {
      return [];
    }

    const email = normalizeEmail(userProfile?.email);
    const userId = Number(userProfile?.id);
    if (!email || !Number.isInteger(userId) || userId < 1) {
      return [];
    }

    if (typeof workspaceInvitesRepository.markExpiredPendingInvites === "function") {
      await workspaceInvitesRepository.markExpiredPendingInvites();
    }

    const rawInvites = await workspaceInvitesRepository.listPendingByEmail(email);
    if (!Array.isArray(rawInvites) || rawInvites.length < 1) {
      return [];
    }

    const filtered = [];
    for (const invite of rawInvites) {
      const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(invite.workspaceId, userId);
      if (!existingMembership || existingMembership.status !== "active") {
        filtered.push(invite);
      }
    }

    return filtered.map(mapPendingInviteSummary);
  }

  async function resolveWorkspaceSelection({ user, userId, requestedWorkspaceSlug, surfaceId }) {
    const memberships = await listMembershipWorkspacesForUser(userId);
    const membershipIndex = createMembershipIndexes(memberships);
    const userSettings = await userSettingsRepository.ensureForUserId(userId);
    const workspaceSettingsCache = new Map();
    let selected = null;
    let requestedSlugRejected = false;

    async function resolveAccess(candidate) {
      if (!candidate || !candidate.workspace) {
        return null;
      }

      const access = await evaluateWorkspaceAccess({
        user,
        surfaceId,
        workspace: candidate.workspace,
        membership: candidate.membership,
        workspaceSettingsCache
      });

      return {
        ...candidate,
        access
      };
    }

    if (requestedWorkspaceSlug) {
      const candidate = await resolveWorkspaceCandidateBySlug({
        workspaceSlug: requestedWorkspaceSlug,
        membershipIndex,
        userId
      });

      if (!candidate) {
        requestedSlugRejected = true;
      } else {
        const resolved = await resolveAccess(candidate);
        if (resolved?.access?.allowed) {
          selected = resolved;
        } else {
          requestedSlugRejected = true;
        }
      }
    }

    if (!selected && userSettings.lastActiveWorkspaceId != null) {
      const candidate = await resolveWorkspaceCandidateById({
        workspaceId: userSettings.lastActiveWorkspaceId,
        membershipIndex,
        userId
      });

      const resolved = await resolveAccess(candidate);
      if (resolved?.access?.allowed) {
        selected = resolved;
      }
    }

    if (!selected && memberships.length === 1) {
      const [membershipWorkspace] = memberships;
      const resolved = await resolveAccess({
        workspace: membershipWorkspace,
        membership: membershipWorkspace
      });

      if (resolved?.access?.allowed) {
        selected = resolved;
      }
    }

    if (selected && Number(userSettings.lastActiveWorkspaceId) !== Number(selected.workspace.id)) {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, selected.workspace.id);
    }

    const workspaces = await Promise.all(
      memberships.map(async (membershipWorkspace) => {
        if (surfaceId !== "app") {
          return mapWorkspaceSummary(membershipWorkspace, {
            isAccessible: true
          });
        }

        const access = await evaluateWorkspaceAccess({
          user,
          surfaceId,
          workspace: membershipWorkspace,
          membership: membershipWorkspace,
          workspaceSettingsCache
        });

        return mapWorkspaceSummary(membershipWorkspace, {
          isAccessible: access.allowed
        });
      })
    );

    return {
      workspaces,
      selected,
      userSettings,
      requestedSlugRejected
    };
  }

  async function resolveRequestContext({ user, request, workspacePolicy = "none", workspaceSurface = "" }) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      return {
        workspace: null,
        membership: null,
        permissions: [],
        workspaces: [],
        userSettings: null
      };
    }

    if (appConfig.tenancyMode === "personal") {
      await ensurePersonalWorkspaceForUser(user);
    }

    const surfaceId = resolveRequestSurfaceId(request, workspaceSurface);
    const requestedWorkspaceSlug = resolveRequestedWorkspaceSlug(request);
    const selection = await resolveWorkspaceSelection({
      user,
      userId,
      requestedWorkspaceSlug,
      surfaceId
    });

    if (selection.requestedSlugRejected) {
      throw new AppError(403, "Forbidden.");
    }

    if (workspacePolicy === "required" && !selection.selected) {
      throw new AppError(409, "Workspace selection required.");
    }

    return {
      workspace: selection.selected
        ? {
            id: Number(selection.selected.workspace.id),
            slug: String(selection.selected.workspace.slug || ""),
            name: String(selection.selected.workspace.name || ""),
            color: normalizeWorkspaceColor(selection.selected.workspace.color),
            avatarUrl: selection.selected.workspace.avatarUrl ? String(selection.selected.workspace.avatarUrl) : "",
            settings: mapWorkspaceSettingsPublic(selection.selected.access.workspaceSettings, {
              appInvitesEnabled: appConfig.features.workspaceInvites,
              collaborationEnabled: rbacManifest.collaborationEnabled
            })
          }
        : null,
      membership: selection.selected ? mapMembershipSummary(selection.selected.membership) : null,
      permissions: selection.selected ? selection.selected.access.permissions : [],
      workspaces: selection.workspaces,
      userSettings: selection.userSettings ? mapUserSettingsPublic(selection.userSettings) : null
    };
  }

  async function buildBootstrapPayload({ request, user }) {
    if (!user) {
      return {
        session: {
          authenticated: false
        },
        profile: null,
        app: {
          tenancyMode: appConfig.tenancyMode,
          features: {
            workspaceSwitching: Boolean(appConfig.features.workspaceSwitching),
            workspaceInvites: Boolean(appConfig.features.workspaceInvites),
            workspaceCreateEnabled: Boolean(appConfig.features.workspaceCreateEnabled)
          }
        },
        workspaces: [],
        pendingInvites: [],
        activeWorkspace: null,
        membership: null,
        permissions: [],
        workspaceSettings: null,
        userSettings: null
      };
    }

    const context = await resolveRequestContext({
      user,
      request,
      workspacePolicy: "optional"
    });

    const avatarSize = context.userSettings?.avatarSize || 64;
    const profileAvatar =
      userAvatarService && typeof userAvatarService.buildAvatarResponse === "function"
        ? userAvatarService.buildAvatarResponse(user, { avatarSize })
        : null;

    const pendingInvites = await listPendingInvitesForUser(user);

    return {
      session: {
        authenticated: true,
        userId: Number(user.id),
        username: user.displayName || null
      },
      profile: {
        displayName: String(user.displayName || ""),
        email: String(user.email || ""),
        avatar: profileAvatar
          ? {
              uploadedUrl: profileAvatar.uploadedUrl,
              gravatarUrl: profileAvatar.gravatarUrl,
              effectiveUrl: profileAvatar.effectiveUrl,
              hasUploadedAvatar: Boolean(profileAvatar.hasUploadedAvatar),
              size: Number(profileAvatar.size || avatarSize),
              version: profileAvatar.version
            }
          : null
      },
      app: {
        tenancyMode: appConfig.tenancyMode,
        features: {
          workspaceSwitching: Boolean(appConfig.features.workspaceSwitching),
          workspaceInvites: Boolean(appConfig.features.workspaceInvites),
          workspaceCreateEnabled: Boolean(appConfig.features.workspaceCreateEnabled)
        }
      },
      workspaces: context.workspaces,
      pendingInvites,
      activeWorkspace: context.workspace
        ? {
            id: context.workspace.id,
            slug: context.workspace.slug,
            name: context.workspace.name,
            color: normalizeWorkspaceColor(context.workspace.color),
            avatarUrl: context.workspace.avatarUrl
          }
        : null,
      membership: context.membership,
      permissions: context.permissions,
      workspaceSettings: context.workspace ? context.workspace.settings : null,
      userSettings: context.userSettings
    };
  }

  async function selectWorkspaceForUser(user, workspaceSelector, options = {}) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(401, "Authentication required.");
    }

    if (appConfig.tenancyMode === "personal") {
      await ensurePersonalWorkspaceForUser(user);
    }

    const rawSelector = String(workspaceSelector || "").trim();
    if (!rawSelector) {
      throw new AppError(400, "workspaceSlug is required.");
    }

    const surfaceId = resolveRequestSurfaceId(options.request);
    const memberships = await listMembershipWorkspacesForUser(userId);
    const membershipIndex = createMembershipIndexes(memberships);
    const workspaceSettingsCache = new Map();

    const candidate = await resolveWorkspaceCandidateBySelector({
      selector: rawSelector,
      membershipIndex,
      userId
    });

    if (!candidate || !candidate.workspace) {
      throw new AppError(403, "Forbidden.");
    }

    const access = await evaluateWorkspaceAccess({
      user,
      surfaceId,
      workspace: candidate.workspace,
      membership: candidate.membership,
      workspaceSettingsCache
    });

    if (!access.allowed) {
      throw new AppError(403, "Forbidden.");
    }

    await userSettingsRepository.updateLastActiveWorkspaceId(userId, candidate.workspace.id);

    return {
      workspace: {
        id: Number(candidate.workspace.id),
        slug: String(candidate.workspace.slug || ""),
        name: String(candidate.workspace.name || ""),
        color: normalizeWorkspaceColor(candidate.workspace.color),
        avatarUrl: candidate.workspace.avatarUrl ? String(candidate.workspace.avatarUrl) : ""
      },
      membership: mapMembershipSummary(candidate.membership),
      permissions: access.permissions,
      workspaceSettings: mapWorkspaceSettingsPublic(access.workspaceSettings, {
        appInvitesEnabled: appConfig.features.workspaceInvites,
        collaborationEnabled: rbacManifest.collaborationEnabled
      })
    };
  }

  async function listWorkspacesForUser(user, options = {}) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(401, "Authentication required.");
    }

    if (appConfig.tenancyMode === "personal") {
      await ensurePersonalWorkspaceForUser(user);
    }

    const surfaceId = resolveRequestSurfaceId(options.request);
    const memberships = await listMembershipWorkspacesForUser(userId);

    if (surfaceId !== "app") {
      return memberships.map((membershipWorkspace) =>
        mapWorkspaceSummary(membershipWorkspace, {
          isAccessible: true
        })
      );
    }

    const workspaceSettingsCache = new Map();
    return Promise.all(
      memberships.map(async (membershipWorkspace) => {
        const access = await evaluateWorkspaceAccess({
          user,
          surfaceId,
          workspace: membershipWorkspace,
          membership: membershipWorkspace,
          workspaceSettingsCache
        });

        return mapWorkspaceSummary(membershipWorkspace, {
          isAccessible: access.allowed
        });
      })
    );
  }

  return {
    ensurePersonalWorkspaceForUser,
    resolveRequestContext,
    buildBootstrapPayload,
    selectWorkspaceForUser,
    listWorkspacesForUser,
    listPendingInvitesForUser,
    resolvePermissions
  };
}

export { createWorkspaceService, mapUserSettingsPublic, mapWorkspaceSettingsPublic, mapPendingInviteSummary };
