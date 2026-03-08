import { createHash } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  normalizeTenancyMode
} from "@jskit-ai/kernel/shared/surface";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  coerceWorkspaceColor
} from "../../shared/settings.js";
import {
  OWNER_ROLE_ID,
  resolveRolePermissions
} from "../../shared/roles.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLowerText(value);
}

function toSlugPart(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "workspace";
}

function buildWorkspaceBaseSlug(user = {}) {
  const displayName = normalizeText(user.displayName);
  if (displayName) {
    return toSlugPart(displayName);
  }
  const email = normalizeEmail(user.email);
  if (email.includes("@")) {
    return toSlugPart(email.split("@")[0]);
  }
  return "workspace";
}

function buildWorkspaceName(user = {}) {
  const displayName = normalizeText(user.displayName);
  if (displayName) {
    return `${displayName}'s Workspace`;
  }
  const email = normalizeEmail(user.email);
  if (email) {
    return `${email}'s Workspace`;
  }
  return "Workspace";
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

function buildPermissionsFromMembership(membership) {
  const roleId = normalizeLowerText(membership?.roleId || "member");
  return resolveRolePermissions(roleId);
}

function hashInviteToken(token) {
  return createHash("sha256").update(normalizeText(token)).digest("hex");
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = normalizeLowerText(value);
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function createService({
  appConfig = {},
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository,
  workspaceInvitesRepository,
  userSettingsRepository,
  userProfilesRepository
} = {}) {
  if (
    !workspacesRepository ||
    !workspaceMembershipsRepository ||
    !workspaceSettingsRepository ||
    !workspaceInvitesRepository ||
    !userSettingsRepository ||
    !userProfilesRepository
  ) {
    throw new Error("workspaceService requires repositories.");
  }

  const defaultAppFeatures = Object.freeze({
    workspaceSwitching: true,
    workspaceInvites: true,
    workspaceCreateEnabled: false,
    assistantEnabled: false,
    assistantRequiredPermission: "",
    socialEnabled: false,
    socialFederationEnabled: false
  });
  const resolvedTenancyMode = normalizeTenancyMode(appConfig.tenancyMode);
  const resolvedWorkspaceColor = coerceWorkspaceColor(appConfig.workspaceColor);
  const resolvedAppFeatures = Object.freeze({
    workspaceSwitching: normalizeBoolean(appConfig.workspaceSwitching, defaultAppFeatures.workspaceSwitching),
    workspaceInvites: normalizeBoolean(appConfig.workspaceInvites, defaultAppFeatures.workspaceInvites),
    workspaceCreateEnabled: normalizeBoolean(appConfig.workspaceCreateEnabled, defaultAppFeatures.workspaceCreateEnabled),
    assistantEnabled: normalizeBoolean(appConfig.assistantEnabled, defaultAppFeatures.assistantEnabled),
    assistantRequiredPermission: normalizeText(appConfig.assistantRequiredPermission),
    socialEnabled: normalizeBoolean(appConfig.socialEnabled, defaultAppFeatures.socialEnabled),
    socialFederationEnabled: normalizeBoolean(appConfig.socialFederationEnabled, defaultAppFeatures.socialFederationEnabled)
  });

  async function ensureUniqueWorkspaceSlug(baseSlug, options = {}) {
    let suffix = 0;
    while (suffix < 1000) {
      suffix += 1;
      const candidate = suffix === 1 ? toSlugPart(baseSlug) : `${toSlugPart(baseSlug)}-${suffix}`;
      const existing = await workspacesRepository.findBySlug(candidate, options);
      if (!existing) {
        return candidate;
      }
    }
    throw new AppError(500, "Unable to generate unique workspace slug.");
  }

  async function ensureWorkspaceSettingsForWorkspace(workspaceId, options = {}) {
    return workspaceSettingsRepository.ensureForWorkspaceId(
      workspaceId,
      {
        ...DEFAULT_WORKSPACE_SETTINGS,
        invitesEnabled: true
      },
      options
    );
  }

  async function ensurePersonalWorkspaceForUser(user, options = {}) {
    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      throw new AppError(400, "Invalid authenticated user payload.");
    }

    const existing = await workspacesRepository.findPersonalByOwnerUserId(normalizedUser.id, options);
    if (existing) {
      await workspaceMembershipsRepository.ensureOwnerMembership(existing.id, normalizedUser.id, options);
      await ensureWorkspaceSettingsForWorkspace(existing.id, options);
      return existing;
    }

    const slug = await ensureUniqueWorkspaceSlug(buildWorkspaceBaseSlug(normalizedUser), options);
    const inserted = await workspacesRepository.insert(
      {
        slug,
        name: buildWorkspaceName(normalizedUser),
        ownerUserId: normalizedUser.id,
        isPersonal: true,
        avatarUrl: "",
        color: resolvedWorkspaceColor
      },
      options
    );

    await workspaceMembershipsRepository.ensureOwnerMembership(inserted.id, normalizedUser.id, options);
    await ensureWorkspaceSettingsForWorkspace(inserted.id, options);
    return inserted;
  }

  async function listWorkspacesForUser(user, options = {}) {
    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      return [];
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      return [];
    }

    await ensurePersonalWorkspaceForUser(normalizedUser, options);
    const list = await workspacesRepository.listForUserId(normalizedUser.id, options);
    const accessible = list
      .map((entry) => mapWorkspaceSummary(entry, { roleId: entry.roleId, status: entry.membershipStatus }))
      .filter((entry) => entry.isAccessible);

    if (resolvedTenancyMode === TENANCY_MODE_PERSONAL) {
      const personalWorkspace = await workspacesRepository.findPersonalByOwnerUserId(normalizedUser.id, options);
      if (!personalWorkspace) {
        return [];
      }
      const personalWorkspaceId = Number(personalWorkspace.id);
      return accessible.filter((entry) => Number(entry.id) === personalWorkspaceId);
    }

    return accessible;
  }

  async function resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      throw new AppError(403, "Workspace context is disabled.");
    }

    const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
    if (!normalizedWorkspaceSlug) {
      throw new AppError(400, "workspaceSlug is required.");
    }

    let workspace = null;
    if (resolvedTenancyMode === TENANCY_MODE_PERSONAL) {
      workspace = await ensurePersonalWorkspaceForUser(normalizedUser, options);
      const personalWorkspaceSlug = normalizeLowerText(workspace.slug);
      if (normalizedWorkspaceSlug !== personalWorkspaceSlug) {
        throw new AppError(403, "Only the personal workspace can be used.");
      }
    } else {
      workspace = await workspacesRepository.findBySlug(normalizedWorkspaceSlug, options);
    }

    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      normalizedUser.id,
      options
    );
    if (!membership || normalizeLowerText(membership.status) !== "active") {
      throw new AppError(403, "You do not have access to this workspace.");
    }

    const workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspace.id, options);
    const permissions = buildPermissionsFromMembership(membership);

    return {
      workspace,
      membership,
      permissions,
      workspaceSettings
    };
  }

  async function buildBootstrapPayload({ request = null, user = null, workspaceSlug = "" } = {}) {
    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      return {
        session: {
          authenticated: false
        },
        profile: null,
        app: {
          tenancyMode: resolvedTenancyMode,
          features: { ...resolvedAppFeatures }
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

    const latestProfile =
      (await userProfilesRepository.findByIdentity({
        provider: normalizedUser.authProvider,
        providerUserId: normalizedUser.authProviderUserId
      })) || normalizedUser;

    const workspaces = await listWorkspacesForUser(latestProfile);
    const normalizedWorkspaceSlug = normalizeText(workspaceSlug);
    let workspaceContext = null;
    if (normalizedWorkspaceSlug) {
      workspaceContext = await resolveWorkspaceContextForUserBySlug(latestProfile, normalizedWorkspaceSlug, {
        request
      });
    }

    const userSettings = await userSettingsRepository.ensureForUserId(latestProfile.id);
    const pendingInvites = await listPendingInvitesForUser(latestProfile);

    return {
      session: {
        authenticated: true,
        userId: latestProfile.id
      },
      profile: {
        displayName: latestProfile.displayName,
        email: latestProfile.email,
        avatar: {
          uploadedUrl: null,
          gravatarUrl: "",
          effectiveUrl: "",
          hasUploadedAvatar: false,
          size: Number(userSettings.avatarSize || 64),
          version: latestProfile.avatarVersion || null
        }
      },
      app: {
        tenancyMode: resolvedTenancyMode,
        features: { ...resolvedAppFeatures }
      },
      workspaces: [...workspaces],
      pendingInvites,
      activeWorkspace: workspaceContext
        ? mapWorkspaceSummary(workspaceContext.workspace, {
            roleId: workspaceContext.membership?.roleId,
            status: workspaceContext.membership?.status
          })
        : null,
      membership: mapMembershipSummary(workspaceContext?.membership, workspaceContext?.workspace),
      permissions: workspaceContext ? [...workspaceContext.permissions] : [],
      workspaceSettings: workspaceContext ? mapWorkspaceSettingsPublic(workspaceContext.workspaceSettings) : null,
      userSettings: {
        theme: userSettings.theme,
        locale: userSettings.locale,
        timeZone: userSettings.timeZone,
        dateFormat: userSettings.dateFormat,
        numberFormat: userSettings.numberFormat,
        currencyCode: userSettings.currencyCode,
        avatarSize: userSettings.avatarSize,
        productUpdates: userSettings.productUpdates,
        accountActivity: userSettings.accountActivity,
        securityAlerts: userSettings.securityAlerts
      },
      requestMeta: {
        hasRequest: Boolean(request)
      }
    };
  }

  async function listPendingInvitesForUser(user, options = {}) {
    if (resolvedTenancyMode !== TENANCY_MODE_WORKSPACE) {
      return [];
    }

    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser || !normalizedUser.email) {
      return [];
    }

    const invites = await workspaceInvitesRepository.listPendingByEmail(normalizedUser.email, options);
    return invites.map((invite) => ({
      id: invite.id,
      workspaceId: invite.workspaceId,
      workspaceSlug: invite.workspaceSlug || "",
      workspaceName: invite.workspaceName || invite.workspaceSlug || "Workspace",
      workspaceAvatarUrl: invite.workspaceAvatarUrl || "",
      roleId: invite.roleId,
      status: invite.status,
      expiresAt: invite.expiresAt,
      token: ""
    }));
  }

  async function redeemInviteByToken({ user, token, decision }, options = {}) {
    if (resolvedTenancyMode !== TENANCY_MODE_WORKSPACE) {
      throw new AppError(403, "Workspace invites are disabled.");
    }

    const normalizedUser = normalizeUserProfile(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    const normalizedDecision = normalizeLowerText(decision);
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "decision must be accept or refuse.");
    }

    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      throw new AppError(400, "Invite token is required.");
    }

    const invite = await workspaceInvitesRepository.findPendingByTokenHash(hashInviteToken(normalizedToken), options);
    if (!invite) {
      throw new AppError(404, "Invitation not found or already handled.");
    }

    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      await workspaceInvitesRepository.revokeById(invite.id, options);
      throw new AppError(409, "Invitation has expired.");
    }

    if (normalizeLowerText(invite.email) !== normalizedUser.email) {
      throw new AppError(403, "Invitation email does not match authenticated user.");
    }

    if (normalizedDecision === "accept") {
      await workspaceMembershipsRepository.upsertMembership(
        invite.workspaceId,
        normalizedUser.id,
        {
          roleId: invite.roleId,
          status: "active"
        },
        options
      );
      await workspaceInvitesRepository.markAcceptedById(invite.id, options);
      const workspace = await workspacesRepository.findById(invite.workspaceId, options);
      if (!workspace) {
        throw new AppError(404, "Workspace not found.");
      }
      const acceptedWorkspace = await resolveWorkspaceContextForUserBySlug(normalizedUser, workspace.slug, options);

      return {
        decision: "accepted",
        workspace: mapWorkspaceSummary(acceptedWorkspace.workspace, acceptedWorkspace.membership),
        membership: mapMembershipSummary(acceptedWorkspace.membership, acceptedWorkspace.workspace),
        permissions: acceptedWorkspace.permissions,
        workspaceSettings: mapWorkspaceSettingsPublic(acceptedWorkspace.workspaceSettings)
      };
    }

    await workspaceInvitesRepository.revokeById(invite.id, options);
    return {
      decision: "refused"
    };
  }

  return Object.freeze({
    toSlugPart,
    buildWorkspaceName,
    buildWorkspaceBaseSlug,
    hashInviteToken,
    ensurePersonalWorkspaceForUser,
    buildBootstrapPayload,
    listWorkspacesForUser,
    resolveWorkspaceContextForUserBySlug,
    listPendingInvitesForUser,
    redeemInviteByToken
  });
}

export { createService };
