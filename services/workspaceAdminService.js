import crypto from "node:crypto";
import { AppError } from "../lib/errors.js";
import { OWNER_ROLE_ID } from "../lib/rbacManifest.js";
import { extractAppSurfacePolicy } from "../surfaces/appSurface.js";
import {
  normalizeEmail,
  parsePositiveInteger,
  coerceWorkspaceColor,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults,
  parseWorkspaceSettingsPatch,
  mapWorkspaceSummary
} from "./workspace-admin/lib/workspaceAdminHelpers.js";

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

  function buildInviteTokenHash() {
    const token = crypto.randomBytes(24).toString("hex");
    return crypto.createHash("sha256").update(token).digest("hex");
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

    await runInInviteTransaction(async (trx) => {
      const options = trx ? { trx } : {};

      await workspaceInvitesRepository.expirePendingByWorkspaceIdAndEmail(workspace.id, email, options);

      try {
        await workspaceInvitesRepository.insert(
          {
            workspaceId: workspace.id,
            email,
            roleId,
            tokenHash: buildInviteTokenHash(),
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

    return listInvites(workspace);
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
      return pending.map(mapInvite);
    }

    const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId(userId, pending);
    const filtered = pending.filter((invite) => {
      const workspaceId = Number(invite?.workspaceId);
      const membership = membershipByWorkspaceId.get(workspaceId);
      return !membership || membership.status !== "active";
    });

    return filtered.map(mapInvite);
  }

  async function respondToPendingInvite({ user, inviteId, decision }) {
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

    return runInAdminTransaction(async (trx) => {
      const options = trx ? { trx } : {};

      const invite = await workspaceInvitesRepository.findPendingByIdAndEmail(inviteId, email, options);
      if (!invite) {
        throw new AppError(404, "Invite not found.");
      }

      if (normalizedDecision === "refuse") {
        await workspaceInvitesRepository.revokeById(invite.id, options);
        return {
          ok: true,
          decision: "refused",
          inviteId: Number(invite.id),
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

      const roleId = normalizeRoleForAssignment(invite.roleId || rbacManifest.defaultInviteRole);
      await workspaceMembershipsRepository.ensureActiveByWorkspaceIdAndUserId(invite.workspaceId, userId, roleId, options);
      await workspaceInvitesRepository.markAcceptedById(invite.id, options);

      if (userSettingsRepository && typeof userSettingsRepository.updateLastActiveWorkspaceId === "function") {
        await userSettingsRepository.updateLastActiveWorkspaceId(userId, invite.workspaceId, options);
      }

      const workspace = invite.workspace ? await workspacesRepository.findById(invite.workspace.id, options) : null;

      return {
        ok: true,
        decision: "accepted",
        inviteId: Number(invite.id),
        workspace: workspace
          ? {
              id: Number(workspace.id),
              slug: String(workspace.slug || ""),
              name: String(workspace.name || ""),
              color: coerceWorkspaceColor(workspace.color),
              avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : ""
            }
          : null
      };
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
    respondToPendingInvite
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
