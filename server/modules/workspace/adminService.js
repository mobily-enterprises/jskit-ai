import { AppError } from "../../../lib/errors.js";
import { OWNER_ROLE_ID } from "../../../lib/rbacManifest.js";
import { extractAppSurfacePolicy } from "../../../surfaces/appSurface.js";
import {
  buildInviteToken,
  encodeInviteTokenHash,
  hashInviteToken,
  normalizeInviteToken,
  resolveInviteTokenHash
} from "./lib/inviteTokens.js";
import {
  normalizeEmail,
  parsePositiveInteger,
  coerceWorkspaceColor,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults,
  parseWorkspaceSettingsPatch,
  mapWorkspaceSummary
} from "./lib/workspaceAdminHelpers.js";

const INVITE_EXPIRY_DAYS = 7;

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
}

function createWorkspaceAdminService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceSettingsRepository,
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  userProfilesRepository,
  userSettingsRepository
}) {
  if (
    !workspacesRepository ||
    !workspaceSettingsRepository ||
    !workspaceMembershipsRepository ||
    !workspaceInvitesRepository ||
    !userProfilesRepository
  ) {
    throw new Error("workspace admin repositories are required.");
  }

  const roleDescriptors = listRoleDescriptors(rbacManifest);
  const assignableRoleIds = resolveAssignableRoleIds(rbacManifest);

  async function requireWorkspace(workspaceContext, options = {}) {
    const workspaceId = parsePositiveInteger(workspaceContext?.id);
    if (!workspaceId) {
      throw new AppError(409, "Workspace selection required.");
    }

    const workspace = await workspacesRepository.findById(workspaceId, options);
    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    return workspace;
  }

  function normalizeRoleForAssignment(roleId) {
    const normalized = String(roleId || "").trim();
    if (!normalized) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is required."
          }
        }
      });
    }

    if (!assignableRoleIds.includes(normalized)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    return normalized;
  }

  async function ensureWorkspaceSettings(workspaceId, options = {}) {
    return workspaceSettingsRepository.ensureForWorkspaceId(workspaceId, {
      invitesEnabled: Boolean(appConfig.features.workspaceInvites),
      features: {},
      policy: {
        defaultMode: "fv",
        defaultTiming: "ordinary",
        defaultPaymentsPerYear: 12,
        defaultHistoryPageSize: 10
      }
    }, options);
  }

  async function runInAdminTransaction(work) {
    if (typeof workspaceInvitesRepository.transaction === "function") {
      return workspaceInvitesRepository.transaction(work);
    }
    if (typeof workspacesRepository.transaction === "function") {
      return workspacesRepository.transaction(work);
    }

    return work(null);
  }

  function mapWorkspaceSettingsResponse(workspace, workspaceSettings, options = {}) {
    const defaults = resolveWorkspaceDefaults(workspaceSettings?.policy);
    const appSurfacePolicy = extractAppSurfacePolicy(workspaceSettings);
    const invitesAvailable = Boolean(appConfig.features.workspaceInvites && rbacManifest.collaborationEnabled);
    const invitesEnabled = Boolean(workspaceSettings?.invitesEnabled);
    const includeAppSurfaceDenyLists = options.includeAppSurfaceDenyLists === true;

    const settings = {
      invitesEnabled,
      invitesAvailable,
      invitesEffective: invitesAvailable && invitesEnabled,
      ...defaults
    };

    if (includeAppSurfaceDenyLists) {
      settings.appDenyEmails = appSurfacePolicy.denyEmails;
      settings.appDenyUserIds = appSurfacePolicy.denyUserIds;
    }

    return {
      workspace: mapWorkspaceSummary(workspace),
      settings
    };
  }

  function mapMember(member, workspace) {
    return {
      userId: Number(member.userId),
      email: String(member.user?.email || ""),
      displayName: String(member.user?.displayName || ""),
      roleId: String(member.roleId || ""),
      status: String(member.status || "active"),
      isOwner: Number(member.userId) === Number(workspace.ownerUserId) || String(member.roleId || "") === OWNER_ROLE_ID
    };
  }

  function mapInvite(invite) {
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

  function mapWorkspacePayload(workspace) {
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

  function resolveInviteExpiresAt() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + INVITE_EXPIRY_DAYS);
    return date.toISOString();
  }

  async function runInInviteTransaction(work) {
    if (typeof workspaceInvitesRepository.transaction === "function") {
      return workspaceInvitesRepository.transaction(work);
    }

    return work(null);
  }

  async function getWorkspaceSettings(workspaceContext, options = {}) {
    const workspace = await requireWorkspace(workspaceContext);
    const workspaceSettings = await ensureWorkspaceSettings(workspace.id);
    const includeAppSurfaceDenyLists = options.includeAppSurfaceDenyLists === true;

    return {
      ...mapWorkspaceSettingsResponse(workspace, workspaceSettings, { includeAppSurfaceDenyLists }),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function updateWorkspaceSettings(workspaceContext, payload) {
    const parsed = parseWorkspaceSettingsPatch(payload);

    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: parsed.fieldErrors
        }
      });
    }

    const workspaceId = parsePositiveInteger(workspaceContext?.id);
    await runInAdminTransaction(async (trx) => {
      const options = trx ? { trx } : {};
      const workspace = await requireWorkspace(workspaceContext, options);

      if (Object.keys(parsed.workspacePatch).length > 0) {
        await workspacesRepository.updateById(workspace.id, parsed.workspacePatch, options);
      }

      const currentSettings = await ensureWorkspaceSettings(workspace.id, options);
      const settingsPatch = {};

      if (Object.prototype.hasOwnProperty.call(parsed.settingsPatch, "invitesEnabled")) {
        settingsPatch.invitesEnabled = parsed.settingsPatch.invitesEnabled;
      }

      if (parsed.settingsPatch.defaults) {
        settingsPatch.policy = {
          ...(currentSettings?.policy && typeof currentSettings.policy === "object" ? currentSettings.policy : {}),
          ...parsed.settingsPatch.defaults
        };
      }

      if (parsed.settingsPatch.appSurfaceAccess) {
        const currentFeatures =
          currentSettings?.features && typeof currentSettings.features === "object" ? currentSettings.features : {};
        const currentSurfaceAccess =
          currentFeatures.surfaceAccess && typeof currentFeatures.surfaceAccess === "object"
            ? currentFeatures.surfaceAccess
            : {};
        const currentAppSurfaceAccess =
          currentSurfaceAccess.app && typeof currentSurfaceAccess.app === "object" ? currentSurfaceAccess.app : {};

        settingsPatch.features = {
          ...currentFeatures,
          surfaceAccess: {
            ...currentSurfaceAccess,
            app: {
              ...currentAppSurfaceAccess,
              ...parsed.settingsPatch.appSurfaceAccess
            }
          }
        };
      }

      if (Object.keys(settingsPatch).length > 0) {
        await workspaceSettingsRepository.updateByWorkspaceId(workspace.id, settingsPatch, options);
      }
    });

    const updatedWorkspace = await workspacesRepository.findById(workspaceId);
    const updatedSettings = await ensureWorkspaceSettings(workspaceId);

    return {
      ...mapWorkspaceSettingsResponse(updatedWorkspace, updatedSettings, { includeAppSurfaceDenyLists: true }),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function listMembers(workspaceContext) {
    const workspace = await requireWorkspace(workspaceContext);
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id);

    return {
      workspace: mapWorkspaceSummary(workspace),
      members: members.map((member) => mapMember(member, workspace)),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function updateMemberRole(workspaceContext, payload) {
    const workspace = await requireWorkspace(workspaceContext);
    const memberUserId = parsePositiveInteger(payload?.memberUserId);
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            memberUserId: "memberUserId is required."
          }
        }
      });
    }

    const roleId = normalizeRoleForAssignment(payload?.roleId);

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      memberUserId
    );
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }

    if (
      Number(memberUserId) === Number(workspace.ownerUserId) ||
      String(existingMembership.roleId || "") === OWNER_ROLE_ID
    ) {
      throw new AppError(409, "Cannot change workspace owner role.");
    }

    await workspaceMembershipsRepository.updateRoleByWorkspaceIdAndUserId(workspace.id, memberUserId, roleId);
    return listMembers(workspace);
  }

  async function listInvites(workspaceContext) {
    const workspace = await requireWorkspace(workspaceContext);
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id);

    return {
      workspace: mapWorkspaceSummary(workspace),
      invites: invites.map(mapInvite),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function createInvite(workspaceContext, actorUser, payload) {
    const workspace = await requireWorkspace(workspaceContext);
    const settings = await ensureWorkspaceSettings(workspace.id);
    const invitesAvailable = Boolean(appConfig.features.workspaceInvites && rbacManifest.collaborationEnabled);

    if (!invitesAvailable || !settings.invitesEnabled) {
      throw new AppError(403, "Workspace invites are disabled.");
    }

    const email = normalizeEmail(payload?.email);
    if (!email) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            email: "Invite email is required."
          }
        }
      });
    }

    const roleId = normalizeRoleForAssignment(payload?.roleId || rbacManifest.defaultInviteRole);
    const existingMembership = await userProfilesRepository.findByEmail(email);
    if (existingMembership) {
      const memberInWorkspace = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
        workspace.id,
        existingMembership.id
      );
      if (memberInWorkspace && memberInWorkspace.status === "active") {
        throw new AppError(409, "User is already a workspace member.");
      }
    }

    const inviteToken = buildInviteToken();
    let createdInvite = null;

    await runInInviteTransaction(async (trx) => {
      const options = trx ? { trx } : {};

      await workspaceInvitesRepository.expirePendingByWorkspaceIdAndEmail(workspace.id, email, options);

      try {
        createdInvite = await workspaceInvitesRepository.insert(
          {
            workspaceId: workspace.id,
            email,
            roleId,
            tokenHash: hashInviteToken(inviteToken),
            invitedByUserId: Number(actorUser?.id) || null,
            expiresAt: resolveInviteExpiresAt(),
            status: "pending"
          },
          options
        );
      } catch (error) {
        if (isMysqlDuplicateEntryError(error)) {
          throw new AppError(409, "A pending invite for this email already exists.");
        }

        throw error;
      }
    });

    const response = await listInvites(workspace);
    return {
      ...response,
      createdInvite: {
        inviteId: Number(createdInvite?.id),
        email,
        token: inviteToken
      }
    };
  }

  async function resolveInviteResponse({
    invite,
    normalizedDecision,
    userId,
    transactionOptions
  }) {
    if (normalizedDecision === "refuse") {
      await workspaceInvitesRepository.revokeById(invite.id, transactionOptions);
      return {
        ok: true,
        decision: "refused",
        inviteId: Number(invite.id),
        workspace: mapWorkspacePayload(invite.workspace)
      };
    }

    const roleId = normalizeRoleForAssignment(invite.roleId || rbacManifest.defaultInviteRole);
    await workspaceMembershipsRepository.ensureActiveByWorkspaceIdAndUserId(
      invite.workspaceId,
      userId,
      roleId,
      transactionOptions
    );
    await workspaceInvitesRepository.markAcceptedById(invite.id, transactionOptions);

    if (userSettingsRepository && typeof userSettingsRepository.updateLastActiveWorkspaceId === "function") {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, invite.workspaceId, transactionOptions);
    }

    const workspace = invite.workspace ? await workspacesRepository.findById(invite.workspace.id, transactionOptions) : null;

    return {
      ok: true,
      decision: "accepted",
      inviteId: Number(invite.id),
      workspace: mapWorkspacePayload(workspace)
    };
  }

  async function revokeInvite(workspaceContext, inviteId) {
    const workspace = await requireWorkspace(workspaceContext);
    const numericInviteId = parsePositiveInteger(inviteId);
    if (!numericInviteId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            inviteId: "inviteId is required."
          }
        }
      });
    }

    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(numericInviteId, workspace.id);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await workspaceInvitesRepository.revokeById(numericInviteId);
    return listInvites(workspace);
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

  async function listPendingInvitesForUser(user) {
    const email = normalizeEmail(user?.email);
    if (!email) {
      return [];
    }

    const pending = await workspaceInvitesRepository.listPendingByEmail(email);
    const userId = parsePositiveInteger(user?.id);

    if (!userId) {
      return pending
        .map((invite) => ({
          ...mapInvite(invite),
          token: encodeInviteTokenHash(invite?.tokenHash)
        }))
        .filter((invite) => Boolean(invite.token));
    }

    const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId(userId, pending);
    const filtered = pending.filter((invite) => {
      const workspaceId = Number(invite?.workspaceId);
      const membership = membershipByWorkspaceId.get(workspaceId);
      return !membership || membership.status !== "active";
    });

    return filtered
      .map((invite) => ({
        ...mapInvite(invite),
        token: encodeInviteTokenHash(invite?.tokenHash)
      }))
      .filter((invite) => Boolean(invite.token));
  }

  async function respondToPendingInviteByToken({ user, inviteToken, decision }) {
    const userId = parsePositiveInteger(user?.id);
    const email = normalizeEmail(user?.email);
    if (!userId || !email) {
      throw new AppError(401, "Authentication required.");
    }

    const normalizedDecision = String(decision || "")
      .trim()
      .toLowerCase();
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            decision: "decision must be accept or refuse."
          }
        }
      });
    }

    const normalizedInviteToken = normalizeInviteToken(inviteToken);
    if (!normalizedInviteToken) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            token: "token is required."
          }
        }
      });
    }
    const inviteTokenHash = resolveInviteTokenHash(normalizedInviteToken);
    if (!inviteTokenHash) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            token: "token is invalid."
          }
        }
      });
    }

    return runInAdminTransaction(async (trx) => {
      const options = trx ? { trx } : {};
      const invite = await workspaceInvitesRepository.findPendingByTokenHash(inviteTokenHash, options);
      if (!invite) {
        throw new AppError(404, "Invite not found.");
      }
      if (normalizeEmail(invite.email) !== email) {
        throw new AppError(403, "Forbidden.");
      }

      return resolveInviteResponse({
        invite,
        normalizedDecision,
        userId,
        transactionOptions: options
      });
    });
  }

  function getRoleCatalog() {
    return {
      collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
      defaultInviteRole: rbacManifest.defaultInviteRole,
      roles: roleDescriptors,
      assignableRoleIds
    };
  }

  return {
    getRoleCatalog,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvitesForUser,
    respondToPendingInviteByToken
  };
}

export {
  createWorkspaceAdminService,
  normalizeEmail,
  parseWorkspaceSettingsPatch,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults
};
