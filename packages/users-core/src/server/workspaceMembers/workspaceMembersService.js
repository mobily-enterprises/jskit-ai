import { buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { OWNER_ROLE_ID, createWorkspaceRoleCatalog, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

function createService({
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  inviteExpiresInMs,
  roleCatalog = null
} = {}) {
  if (!workspaceMembershipsRepository || !workspaceInvitesRepository) {
    throw new Error("workspaceMembersService requires membership and invite repositories.");
  }
  const resolvedInviteExpiresInMs = Number(inviteExpiresInMs);
  if (!Number.isInteger(resolvedInviteExpiresInMs) || resolvedInviteExpiresInMs < 1) {
    throw new Error("workspaceMembersService requires inviteExpiresInMs.");
  }

  const resolvedRoleCatalog = roleCatalog && typeof roleCatalog === "object" ? roleCatalog : createWorkspaceRoleCatalog();
  const assignableRoleIds = Array.isArray(resolvedRoleCatalog.assignableRoleIds)
    ? [...resolvedRoleCatalog.assignableRoleIds]
    : [];

  function withRoleCatalog(payload = {}) {
    return {
      ...payload,
      roleCatalog: cloneWorkspaceRoleCatalog({
        ...resolvedRoleCatalog,
        assignableRoleIds
      })
    };
  }

  async function listRoles(options = {}) {
    return cloneWorkspaceRoleCatalog({
      ...resolvedRoleCatalog,
      assignableRoleIds
    });
  }

  async function listMembersPayload(workspace, options = {}) {
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id, options);

    return withRoleCatalog({
      workspace,
      members
    });
  }

  async function listMembers(workspace, options = {}) {
    return listMembersPayload(workspace, options);
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

    return listMembersPayload(workspace, options);
  }

  async function removeMember(workspace, payload = {}, options = {}) {
    const memberUserId = payload.memberUserId;

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }
    if (Number(memberUserId) === Number(workspace.ownerUserId) || existingMembership.roleId === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot remove workspace owner.");
    }

    await workspaceMembershipsRepository.upsertMembership(
      workspace.id,
      memberUserId,
      {
        roleId: existingMembership.roleId,
        status: "revoked"
      },
      options
    );

    return listMembersPayload(workspace, options);
  }

  async function listInvitesPayload(workspace, options = {}) {
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id, options);

    return withRoleCatalog({
      workspace,
      invites
    });
  }

  async function listInvites(workspace, options = {}) {
    return listInvitesPayload(workspace, options);
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
    const createdInvite = await workspaceInvitesRepository.insert(
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
    const createdInviteId = Number(createdInvite?.id);
    if (!Number.isInteger(createdInviteId) || createdInviteId < 1) {
      throw new Error("workspaceMembersService.createInvite expected repository to return created invite id.");
    }

    const response = await listInvitesPayload(workspace, options);
    return {
      ...response,
      inviteTokenPreview: token,
      createdInviteId
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
    const revokedInviteId = Number(invite?.id);
    if (!Number.isInteger(revokedInviteId) || revokedInviteId < 1) {
      throw new Error("workspaceMembersService.revokeInvite expected repository to return pending invite id.");
    }

    const response = await listInvitesPayload(workspace, options);
    return {
      ...response,
      revokedInviteId
    };
  }

  return Object.freeze({
    listRoles,
    listMembers,
    updateMemberRole,
    removeMember,
    listInvites,
    createInvite,
    revokeInvite
  });
}

export { createService };
