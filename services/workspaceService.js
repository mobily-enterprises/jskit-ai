import { AppError } from "../lib/errors.js";
import { OWNER_ROLE_ID, resolveRolePermissions } from "../lib/rbacManifest.js";
import { resolveWorkspaceDefaults } from "./workspaceAdminService.js";

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

function mapWorkspaceSummary(workspaceRow) {
  return {
    id: Number(workspaceRow.id),
    slug: String(workspaceRow.slug || ""),
    name: String(workspaceRow.name || ""),
    avatarUrl: workspaceRow.avatarUrl ? String(workspaceRow.avatarUrl) : "",
    roleId: String(workspaceRow.roleId || "")
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
    lastActiveWorkspaceId: userSettings?.lastActiveWorkspaceId == null ? null : Number(userSettings.lastActiveWorkspaceId)
  };
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
    await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      invitesEnabled: false,
      features: {},
      policy: {
        defaultMode: "fv",
        defaultTiming: "ordinary",
        defaultPaymentsPerYear: 12,
        defaultHistoryPageSize: 10
      }
    });

    const userSettings = await userSettingsRepository.ensureForUserId(userId);
    if (!userSettings.lastActiveWorkspaceId) {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, workspace.id);
    }

    return workspace;
  }

  async function listAccessibleWorkspacesForUser(userId) {
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

  async function resolveWorkspaceSelection({ userId, requestedWorkspaceSlug }) {
    const memberships = await listAccessibleWorkspacesForUser(userId);
    const userSettings = await userSettingsRepository.ensureForUserId(userId);
    let selected = null;
    let requestedSlugRejected = false;

    if (requestedWorkspaceSlug) {
      const slug = String(requestedWorkspaceSlug).trim();
      selected = memberships.find((item) => item.slug === slug) || null;
      requestedSlugRejected = !selected;
    }

    if (!selected && userSettings.lastActiveWorkspaceId != null) {
      const targetId = Number(userSettings.lastActiveWorkspaceId);
      selected = memberships.find((item) => Number(item.id) === targetId) || null;
    }

    if (!selected && memberships.length === 1) {
      [selected] = memberships;
    }

    if (selected && Number(userSettings.lastActiveWorkspaceId) !== Number(selected.id)) {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, selected.id);
    }

    return {
      memberships,
      selected,
      userSettings,
      requestedSlugRejected
    };
  }

  async function resolveRequestContext({ user, request, workspacePolicy = "none" }) {
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

    const requestedWorkspaceSlug = resolveRequestedWorkspaceSlug(request);
    const selection = await resolveWorkspaceSelection({
      userId,
      requestedWorkspaceSlug
    });

    if (selection.requestedSlugRejected) {
      throw new AppError(403, "Forbidden.");
    }

    if (workspacePolicy === "required" && !selection.selected) {
      throw new AppError(409, "Workspace selection required.");
    }

    let workspaceSettings = null;
    if (selection.selected) {
      workspaceSettings = await workspaceSettingsRepository.ensureForWorkspaceId(selection.selected.id, {
        invitesEnabled: Boolean(appConfig.features.workspaceInvites),
        features: {},
        policy: {
          defaultMode: "fv",
          defaultTiming: "ordinary",
          defaultPaymentsPerYear: 12,
          defaultHistoryPageSize: 10
        }
      });
    }

    return {
      workspace: selection.selected
        ? {
            id: Number(selection.selected.id),
            slug: String(selection.selected.slug || ""),
            name: String(selection.selected.name || ""),
            avatarUrl: selection.selected.avatarUrl ? String(selection.selected.avatarUrl) : "",
            settings: mapWorkspaceSettingsPublic(workspaceSettings, {
              appInvitesEnabled: appConfig.features.workspaceInvites,
              collaborationEnabled: rbacManifest.collaborationEnabled
            })
          }
        : null,
      membership: selection.selected
        ? {
            roleId: String(selection.selected.roleId || ""),
            status: String(selection.selected.membershipStatus || "active")
          }
        : null,
      permissions: selection.selected ? resolvePermissions(selection.selected.roleId) : [],
      workspaces: selection.memberships.map(mapWorkspaceSummary),
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
            avatarUrl: context.workspace.avatarUrl
          }
        : null,
      membership: context.membership,
      permissions: context.permissions,
      workspaceSettings: context.workspace ? context.workspace.settings : null,
      userSettings: context.userSettings
    };
  }

  async function selectWorkspaceForUser(user, workspaceSelector) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(401, "Authentication required.");
    }

    const rawSelector = String(workspaceSelector || "").trim();
    if (!rawSelector) {
      throw new AppError(400, "workspaceSlug is required.");
    }

    const workspaces = await listAccessibleWorkspacesForUser(userId);
    const selected =
      workspaces.find((workspace) => workspace.slug === rawSelector) ||
      workspaces.find((workspace) => Number(workspace.id) === Number(rawSelector));

    if (!selected) {
      throw new AppError(403, "Forbidden.");
    }

    await userSettingsRepository.updateLastActiveWorkspaceId(userId, selected.id);
    const workspaceSettings = await workspaceSettingsRepository.ensureForWorkspaceId(selected.id, {
      invitesEnabled: Boolean(appConfig.features.workspaceInvites),
      features: {},
      policy: {
        defaultMode: "fv",
        defaultTiming: "ordinary",
        defaultPaymentsPerYear: 12,
        defaultHistoryPageSize: 10
      }
    });

    return {
      workspace: {
        id: Number(selected.id),
        slug: String(selected.slug || ""),
        name: String(selected.name || ""),
        avatarUrl: selected.avatarUrl ? String(selected.avatarUrl) : ""
      },
      membership: {
        roleId: String(selected.roleId || ""),
        status: String(selected.membershipStatus || "active")
      },
      permissions: resolvePermissions(selected.roleId),
      workspaceSettings: mapWorkspaceSettingsPublic(workspaceSettings, {
        appInvitesEnabled: appConfig.features.workspaceInvites,
        collaborationEnabled: rbacManifest.collaborationEnabled
      })
    };
  }

  async function listWorkspacesForUser(user) {
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(401, "Authentication required.");
    }

    if (appConfig.tenancyMode === "personal") {
      await ensurePersonalWorkspaceForUser(user);
    }

    return listAccessibleWorkspacesForUser(userId).then((rows) => rows.map(mapWorkspaceSummary));
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
