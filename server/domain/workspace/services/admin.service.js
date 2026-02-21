import { AppError } from "../../../lib/errors.js";
import { OWNER_ROLE_ID } from "../../../lib/rbacManifest.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { isMysqlDuplicateEntryError } from "../../../lib/primitives/mysqlErrors.js";
import {
  buildInviteToken,
  encodeInviteTokenHash,
  hashInviteToken,
  normalizeInviteToken,
  resolveInviteTokenHash
} from "../policies/inviteTokens.js";
import { listRoleDescriptors, resolveAssignableRoleIds } from "../policies/workspaceRoleCatalog.js";
import { createWorkspaceSettingsDefaults } from "../policies/workspacePolicyDefaults.js";
import { parseWorkspaceSettingsPatch } from "../policies/workspaceSettingsPatch.js";
import { mapWorkspaceAdminSummary } from "../mappers/workspaceMappers.js";
import {
  mapWorkspaceSettingsResponse,
  mapWorkspaceMemberSummary,
  mapWorkspaceInviteSummary,
  mapWorkspacePayloadSummary
} from "../mappers/workspaceAdminMappers.js";
import { resolveInviteExpiresAt } from "../policies/workspaceInvitePolicy.js";
import { listInviteMembershipsByWorkspaceId } from "../lookups/workspaceMembershipLookup.js";
import { applyTranscriptModeToWorkspaceFeatures } from "../../../lib/aiTranscriptMode.js";
import { applyAssistantSystemPromptAppToWorkspaceFeatures } from "../../../lib/aiAssistantSystemPrompt.js";

function createService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceSettingsRepository,
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  userProfilesRepository,
  userSettingsRepository,
  workspaceInviteEmailService
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
    return workspaceSettingsRepository.ensureForWorkspaceId(
      workspaceId,
      createWorkspaceSettingsDefaults(Boolean(appConfig.features.workspaceInvites)),
      options
    );
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
      ...mapWorkspaceSettingsResponse(workspace, workspaceSettings, {
        appInvitesEnabled: appConfig.features.workspaceInvites,
        collaborationEnabled: rbacManifest.collaborationEnabled,
        includeAppSurfaceDenyLists
      }),
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

      if (Object.hasOwn(parsed.settingsPatch, "invitesEnabled")) {
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

      if (Object.hasOwn(parsed.settingsPatch, "aiTranscriptMode")) {
        const baseFeatures =
          settingsPatch.features && typeof settingsPatch.features === "object"
            ? settingsPatch.features
            : currentSettings?.features && typeof currentSettings.features === "object"
              ? currentSettings.features
              : {};
        settingsPatch.features = applyTranscriptModeToWorkspaceFeatures(
          baseFeatures,
          parsed.settingsPatch.aiTranscriptMode
        );
      }

      if (parsed.settingsPatch.assistantSystemPrompts) {
        const baseFeatures =
          settingsPatch.features && typeof settingsPatch.features === "object"
            ? settingsPatch.features
            : currentSettings?.features && typeof currentSettings.features === "object"
              ? currentSettings.features
              : {};
        settingsPatch.features = applyAssistantSystemPromptAppToWorkspaceFeatures(
          baseFeatures,
          parsed.settingsPatch.assistantSystemPrompts.app
        );
      }

      if (Object.keys(settingsPatch).length > 0) {
        await workspaceSettingsRepository.updateByWorkspaceId(workspace.id, settingsPatch, options);
      }
    });

    const updatedWorkspace = await workspacesRepository.findById(workspaceId);
    const updatedSettings = await ensureWorkspaceSettings(workspaceId);

    return {
      ...mapWorkspaceSettingsResponse(updatedWorkspace, updatedSettings, {
        appInvitesEnabled: appConfig.features.workspaceInvites,
        collaborationEnabled: rbacManifest.collaborationEnabled,
        includeAppSurfaceDenyLists: true
      }),
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
      workspace: mapWorkspaceAdminSummary(workspace),
      members: members.map((member) => mapWorkspaceMemberSummary(member, workspace)),
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
      workspace: mapWorkspaceAdminSummary(workspace),
      invites: invites.map(mapWorkspaceInviteSummary),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function invitedUserHasWorkspace(profile) {
    const profileUserId = parsePositiveInteger(profile?.id);
    if (!profileUserId || typeof workspacesRepository.listByUserId !== "function") {
      return false;
    }

    try {
      const workspaces = await workspacesRepository.listByUserId(profileUserId);
      return Array.isArray(workspaces) && workspaces.length > 0;
    } catch {
      return false;
    }
  }

  async function sendInviteEmailBestEffort({ inviteeEmail, roleId, workspace, actorUser }) {
    if (!workspaceInviteEmailService || typeof workspaceInviteEmailService.sendWorkspaceInviteEmail !== "function") {
      return;
    }

    try {
      await workspaceInviteEmailService.sendWorkspaceInviteEmail({
        email: inviteeEmail,
        roleId,
        workspace: {
          id: workspace?.id,
          slug: workspace?.slug,
          name: workspace?.name
        },
        invitedBy: {
          userId: Number(actorUser?.id) || null,
          displayName: actorUser?.displayName || actorUser?.email || "",
          email: actorUser?.email || ""
        }
      });
    } catch {
      // Invite creation should not fail when notification delivery fails.
    }
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
    const existingProfile = await userProfilesRepository.findByEmail(email);
    if (existingProfile) {
      const memberInWorkspace = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
        workspace.id,
        existingProfile.id
      );
      if (memberInWorkspace && memberInWorkspace.status === "active") {
        throw new AppError(409, "User is already a workspace member.");
      }
    }

    const shouldSendInviteEmail = !existingProfile || !(await invitedUserHasWorkspace(existingProfile));
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

    if (shouldSendInviteEmail) {
      await sendInviteEmailBestEffort({
        inviteeEmail: email,
        roleId,
        workspace,
        actorUser
      });
    }

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
        workspace: mapWorkspacePayloadSummary(invite.workspace)
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
      workspace: mapWorkspacePayloadSummary(workspace)
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
          ...mapWorkspaceInviteSummary(invite),
          token: encodeInviteTokenHash(invite?.tokenHash)
        }))
        .filter((invite) => Boolean(invite.token));
    }

    const membershipByWorkspaceId = await listInviteMembershipsByWorkspaceId({
      workspaceMembershipsRepository,
      userId,
      invites: pending
    });
    const filtered = pending.filter((invite) => {
      const workspaceId = Number(invite?.workspaceId);
      const membership = membershipByWorkspaceId.get(workspaceId);
      return !membership || membership.status !== "active";
    });

    return filtered
      .map((invite) => ({
        ...mapWorkspaceInviteSummary(invite),
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

export { createService };
