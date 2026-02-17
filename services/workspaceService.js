import { AppError } from "../lib/errors.js";
import { OWNER_ROLE_ID, resolveRolePermissions } from "../lib/rbacManifest.js";

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

function mapWorkspaceSummary(workspaceRow) {
  return {
    id: workspaceRow.id,
    slug: workspaceRow.slug,
    name: workspaceRow.name,
    roleId: workspaceRow.roleId
  };
}

function mapWorkspaceSettingsPublic(workspaceSettings, options = {}) {
  if (!workspaceSettings) {
    return null;
  }

  const workspaceInvitesEnabled = Boolean(workspaceSettings.invitesEnabled);
  const appInvitesEnabled = Boolean(options.appInvitesEnabled);
  const collaborationEnabled = Boolean(options.collaborationEnabled);

  return {
    invitesEnabled: appInvitesEnabled && collaborationEnabled && workspaceInvitesEnabled
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
    defaultMode: userSettings?.defaultMode || "fv",
    defaultTiming: userSettings?.defaultTiming || "ordinary",
    defaultPaymentsPerYear: Number(userSettings?.defaultPaymentsPerYear || 12),
    defaultHistoryPageSize: Number(userSettings?.defaultHistoryPageSize || 10),
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

function createWorkspaceService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository,
  userSettingsRepository,
  userAvatarService
}) {
  if (!workspacesRepository || !workspaceMembershipsRepository || !workspaceSettingsRepository || !userSettingsRepository) {
    throw new Error("workspace service repositories are required.");
  }

  async function ensureUniqueWorkspaceSlug(baseSlug) {
    let candidate = toSlugPart(baseSlug) || "workspace";
    let suffix = 1;

    // Small bounded loop to avoid unbounded collisions in case of bad data.
    // In practice this exits very quickly.
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
        isPersonal: true
      }));

    await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, userId);
    await workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      invitesEnabled: false,
      features: {},
      policy: {}
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
        policy: {}
      });
    }

    return {
      workspace: selection.selected
        ? {
            id: selection.selected.id,
            slug: selection.selected.slug,
            name: selection.selected.name,
            settings: mapWorkspaceSettingsPublic(workspaceSettings, {
              appInvitesEnabled: appConfig.features.workspaceInvites,
              collaborationEnabled: rbacManifest.collaborationEnabled
            })
          }
        : null,
      membership: selection.selected
        ? {
            roleId: selection.selected.roleId,
            status: selection.selected.membershipStatus
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
            workspaceSwitching: Boolean(appConfig.features.workspaceSwitching)
          }
        },
        workspaces: [],
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
          workspaceSwitching: Boolean(appConfig.features.workspaceSwitching)
        }
      },
      workspaces: context.workspaces,
      activeWorkspace: context.workspace
        ? {
            id: context.workspace.id,
            slug: context.workspace.slug,
            name: context.workspace.name
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
      policy: {}
    });

    return {
      workspace: {
        id: selected.id,
        slug: selected.slug,
        name: selected.name
      },
      membership: {
        roleId: selected.roleId,
        status: selected.membershipStatus
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
    resolvePermissions
  };
}

export { createWorkspaceService, mapUserSettingsPublic, mapWorkspaceSettingsPublic };
