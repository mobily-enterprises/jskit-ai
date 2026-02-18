import { AppError } from "../lib/errors.js";
import { OWNER_ROLE_ID, resolveRolePermissions } from "../lib/rbacManifest.js";
import { normalizeSurfaceId, resolveSurfaceById } from "../surfaces/index.js";
import {
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
  normalizeMembershipForAccess,
  mapMembershipSummary,
  normalizePermissions,
  createWorkspaceSettingsDefaults,
  createMembershipIndexes
} from "./workspace/lib/workspaceHelpers.js";

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
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
  if (
    !workspacesRepository ||
    !workspaceMembershipsRepository ||
    !workspaceSettingsRepository ||
    !userSettingsRepository
  ) {
    throw new Error("workspace service repositories are required.");
  }

  async function ensureUniqueWorkspaceSlug(baseSlug, options = {}) {
    let candidate = toSlugPart(baseSlug) || "workspace";
    let suffix = 1;

    while (suffix < 10000) {
      const existing = await workspacesRepository.findBySlug(candidate, options);
      if (!existing) {
        return candidate;
      }
      suffix += 1;
      candidate = `${toSlugPart(baseSlug) || "workspace"}-${suffix}`;
    }

    throw new AppError(500, "Unable to generate a unique workspace slug.");
  }

  async function ensureWorkspaceSettingsForWorkspace(workspaceId, options = {}) {
    return workspaceSettingsRepository.ensureForWorkspaceId(
      workspaceId,
      createWorkspaceSettingsDefaults(Boolean(appConfig.features.workspaceInvites)),
      options
    );
  }

  async function runInTransaction(work) {
    if (typeof workspacesRepository.transaction === "function") {
      return workspacesRepository.transaction(work);
    }

    return work(null);
  }

  async function createPersonalWorkspaceWithRetry(userProfile, userId, options = {}) {
    const maxAttempts = 10;
    const baseSlug = buildWorkspaceBaseSlug(userProfile);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await workspacesRepository.insert(
          {
            slug: await ensureUniqueWorkspaceSlug(baseSlug, options),
            name: buildWorkspaceName(userProfile),
            ownerUserId: userId,
            isPersonal: true,
            avatarUrl: ""
          },
          options
        );
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }

        const existingWorkspace = await workspacesRepository.findPersonalByOwnerUserId(userId, {
          ...options,
          forUpdate: true
        });
        if (existingWorkspace) {
          return existingWorkspace;
        }
      }
    }

    throw new AppError(500, "Unable to provision personal workspace. Please retry.");
  }

  async function ensurePersonalWorkspaceForUser(userProfile) {
    const userId = Number(userProfile?.id);
    if (!Number.isInteger(userId) || userId < 1) {
      throw new AppError(400, "Cannot ensure personal workspace without a valid user id.");
    }

    return runInTransaction(async (trx) => {
      const transactionOptions = trx ? { trx } : {};
      const existingWorkspace = await workspacesRepository.findPersonalByOwnerUserId(userId, {
        ...transactionOptions,
        forUpdate: true
      });
      const workspace =
        existingWorkspace || (await createPersonalWorkspaceWithRetry(userProfile, userId, transactionOptions));

      await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, userId, transactionOptions);
      await ensureWorkspaceSettingsForWorkspace(workspace.id, transactionOptions);

      const userSettings = await userSettingsRepository.ensureForUserId(userId, transactionOptions);
      if (!userSettings.lastActiveWorkspaceId) {
        await userSettingsRepository.updateLastActiveWorkspaceId(userId, workspace.id, transactionOptions);
      }

      return workspace;
    });
  }

  async function listMembershipWorkspacesForUser(userId) {
    return workspacesRepository.listByUserId(userId);
  }

  async function preloadWorkspaceSettingsForWorkspaceIds(workspaceIds, workspaceSettingsCache) {
    const unresolvedWorkspaceIds = Array.from(
      new Set(
        (Array.isArray(workspaceIds) ? workspaceIds : [])
          .map((workspaceId) => Number(workspaceId))
          .filter(
            (workspaceId) =>
              Number.isInteger(workspaceId) && workspaceId > 0 && !workspaceSettingsCache.has(workspaceId)
          )
      )
    );
    if (unresolvedWorkspaceIds.length < 1) {
      return;
    }

    if (typeof workspaceSettingsRepository.findByWorkspaceIds === "function") {
      const existingSettings = await workspaceSettingsRepository.findByWorkspaceIds(unresolvedWorkspaceIds);
      for (const workspaceSettings of Array.isArray(existingSettings) ? existingSettings : []) {
        const workspaceId = Number(workspaceSettings?.workspaceId);
        if (Number.isInteger(workspaceId) && workspaceId > 0) {
          workspaceSettingsCache.set(workspaceId, workspaceSettings);
        }
      }
    }

    const missingWorkspaceIds = unresolvedWorkspaceIds.filter((workspaceId) => !workspaceSettingsCache.has(workspaceId));
    if (missingWorkspaceIds.length < 1) {
      return;
    }

    await Promise.all(
      missingWorkspaceIds.map(async (workspaceId) => {
        const workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspaceId);
        workspaceSettingsCache.set(workspaceId, workspaceSettings);
      })
    );
  }

  function resolvePermissions(roleId) {
    const normalizedRoleId = String(roleId || "")
      .trim()
      .toLowerCase();
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

  async function listInviteMembershipsByWorkspaceId(userId, invites) {
    const workspaceIds = Array.from(
      new Set(
        invites
          .map((invite) => Number(invite?.workspaceId))
          .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
      )
    );

    if (workspaceIds.length < 1) {
      return new Map();
    }

    if (typeof workspaceMembershipsRepository.listByUserIdAndWorkspaceIds === "function") {
      const memberships = await workspaceMembershipsRepository.listByUserIdAndWorkspaceIds(userId, workspaceIds);
      const membershipByWorkspaceId = new Map();

      for (const membership of memberships) {
        const workspaceId = Number(membership?.workspaceId);
        if (Number.isInteger(workspaceId) && workspaceId > 0 && !membershipByWorkspaceId.has(workspaceId)) {
          membershipByWorkspaceId.set(workspaceId, membership);
        }
      }

      return membershipByWorkspaceId;
    }

    const membershipByWorkspaceId = new Map();
    for (const workspaceId of workspaceIds) {
      const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
      if (membership) {
        membershipByWorkspaceId.set(workspaceId, membership);
      }
    }

    return membershipByWorkspaceId;
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

    const rawInvites = await workspaceInvitesRepository.listPendingByEmail(email);
    if (!Array.isArray(rawInvites) || rawInvites.length < 1) {
      return [];
    }

    const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId(userId, rawInvites);
    const filtered = rawInvites.filter((invite) => {
      const workspaceId = Number(invite?.workspaceId);
      const existingMembership = membershipByWorkspaceId.get(workspaceId);
      return !existingMembership || existingMembership.status !== "active";
    });

    return filtered.map(mapPendingInviteSummary);
  }

  async function mapAccessibleMembershipWorkspaces({ user, surfaceId, memberships, workspaceSettingsCache }) {
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

  async function resolveWorkspaceSelection({ user, userId, requestedWorkspaceSlug, surfaceId }) {
    const memberships = await listMembershipWorkspacesForUser(userId);
    const membershipIndex = createMembershipIndexes(memberships);
    const userSettings = await userSettingsRepository.ensureForUserId(userId);
    const workspaceSettingsCache = new Map();
    await preloadWorkspaceSettingsForWorkspaceIds(
      memberships.map((membershipWorkspace) => membershipWorkspace.id),
      workspaceSettingsCache
    );
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

    const workspaces = await mapAccessibleMembershipWorkspaces({
      user,
      surfaceId,
      memberships,
      workspaceSettingsCache
    });

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
    const workspaceSettingsCache = new Map();
    await preloadWorkspaceSettingsForWorkspaceIds(
      memberships.map((membershipWorkspace) => membershipWorkspace.id),
      workspaceSettingsCache
    );
    return mapAccessibleMembershipWorkspaces({
      user,
      surfaceId,
      memberships,
      workspaceSettingsCache
    });
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
