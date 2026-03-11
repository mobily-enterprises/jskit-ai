import { buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { ASSIGNABLE_ROLE_IDS, OWNER_ROLE_ID } from "../../shared/roles.js";

function createService({
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  inviteExpiresInMs
} = {}) {
  if (!workspaceMembershipsRepository || !workspaceInvitesRepository) {
    throw new Error("workspaceMembersService requires membership and invite repositories.");
  }
  const resolvedInviteExpiresInMs = Number(inviteExpiresInMs);
  if (!Number.isInteger(resolvedInviteExpiresInMs) || resolvedInviteExpiresInMs < 1) {
    throw new Error("workspaceMembersService requires inviteExpiresInMs.");
  }

  const assignableRoleIds = ASSIGNABLE_ROLE_IDS;

  async function listMembers(workspace, options = {}) {
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id, options);

    return {
      workspace,
      members
    };
  }

  async function updateMemberRole(workspace, payload = {}, options = {}) {
    const memberUserId = payload.memberUserId;
    const roleId = payload.roleId;
    if (!assignableRoleIds.includes(roleId)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }
    if (Number(memberUserId) === Number(workspace.ownerUserId) || existingMembership.roleId === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot change workspace owner role.");
    }

    await workspaceMembershipsRepository.upsertMembership(
      workspace.id,
      memberUserId,
      {
        roleId,
        status: "active"
      },
      options
    );

    return listMembers(workspace, options);
  }

  async function listInvites(workspace, options = {}) {
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id, options);

    return {
      workspace,
      invites
    };
  }

  async function createInvite(workspace, user, payload = {}, options = {}) {
    const email = payload.email;
    const roleId = payload.roleId;
    if (!assignableRoleIds.includes(roleId)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    const token = buildInviteToken();
    const tokenHash = hashInviteToken(token);
    await workspaceInvitesRepository.expirePendingByWorkspaceIdAndEmail(workspace.id, email, options);
    await workspaceInvitesRepository.insert(
      {
        workspaceId: workspace.id,
        email,
        roleId,
        status: "pending",
        tokenHash,
        invitedByUserId: Number(user?.id || 0) || null,
        expiresAt: new Date(Date.now() + resolvedInviteExpiresInMs).toISOString()
      },
      options
    );

    const response = await listInvites(workspace, options);
    return {
      ...response,
      inviteTokenPreview: token
    };
  }

  async function revokeInvite(workspace, inviteId, options = {}) {
    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(
      inviteId,
      workspace.id,
      options
    );
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await workspaceInvitesRepository.revokeById(inviteId, options);
    return listInvites(workspace, options);
  }

  return Object.freeze({
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite
  });
}

export { createService };
