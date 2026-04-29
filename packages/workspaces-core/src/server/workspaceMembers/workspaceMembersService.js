import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { OWNER_ROLE_ID, createWorkspaceRoleCatalog, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

function createService({
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  inviteExpiresInMs,
  roleCatalog = null,
  workspaceInvitationsEnabled = true
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
  const resolvedWorkspaceInvitationsEnabled = workspaceInvitationsEnabled === true;

  function ensureWorkspaceInvitationsEnabled() {
    if (resolvedWorkspaceInvitationsEnabled) {
      return;
    }
    throw new AppError(403, "Workspace invitations are disabled.");
  }

  function withRoleCatalog(payload = {}) {
    return {
      ...payload,
      roleCatalog: cloneWorkspaceRoleCatalog({
        ...resolvedRoleCatalog,
        assignableRoleIds
      })
    };
  }

  function mapWorkspaceSummary(workspace = {}) {
    return {
      id: normalizeRecordId(workspace.id, { fallback: "" }),
      slug: normalizeText(workspace.slug),
      name: normalizeText(workspace.name),
      ownerUserId: normalizeRecordId(workspace.ownerUserId, { fallback: "" }),
      avatarUrl: normalizeText(workspace.avatarUrl)
    };
  }

  function mapMemberSummary(member = {}, workspace = {}) {
    const userId = normalizeRecordId(member.userId, { fallback: "" });
    const roleSid = normalizeLowerText(member.roleSid || "member") || "member";

    return {
      userId,
      roleSid,
      status: normalizeLowerText(member.status || "active") || "active",
      displayName: normalizeText(member.displayName),
      email: normalizeLowerText(member.email),
      isOwner: userId === normalizeRecordId(workspace.ownerUserId, { fallback: "" }) || roleSid === OWNER_ROLE_ID
    };
  }

  function mapInviteSummary(invite = {}) {
    return {
      id: normalizeRecordId(invite.id, { fallback: "" }),
      email: normalizeLowerText(invite.email),
      roleSid: normalizeLowerText(invite.roleSid || "member") || "member",
      status: normalizeLowerText(invite.status || "pending") || "pending",
      expiresAt: invite.expiresAt || null,
      invitedByUserId: invite.invitedByUserId == null ? null : normalizeRecordId(invite.invitedByUserId, { fallback: null })
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
      workspace: mapWorkspaceSummary(workspace),
      members: members.map((member) => mapMemberSummary(member, workspace))
    });
  }

  async function listMembers(workspace, options = {}) {
    return listMembersPayload(workspace, options);
  }

  async function updateMemberRole(workspace, payload = {}, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    const roleSid = normalizeLowerText(payload.roleSid || "");
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.");
    }
    if (!assignableRoleIds.includes(roleSid)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleSid: "Role is not assignable."
          }
        }
      });
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }
    if (memberUserId === normalizeRecordId(workspace.ownerUserId, { fallback: null }) || existingMembership.roleSid === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot change workspace owner role.");
    }

    await workspaceMembershipsRepository.upsertMembership(
      workspace.id,
      memberUserId,
      {
        roleSid,
        status: "active"
      },
      options
    );

    return listMembersPayload(workspace, options);
  }

  async function removeMember(workspace, payload = {}, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.");
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }
    if (memberUserId === normalizeRecordId(workspace.ownerUserId, { fallback: null }) || existingMembership.roleSid === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot remove workspace owner.");
    }

    await workspaceMembershipsRepository.upsertMembership(
      workspace.id,
      memberUserId,
      {
        roleSid: existingMembership.roleSid,
        status: "revoked"
      },
      options
    );

    return listMembersPayload(workspace, options);
  }

  async function listInvitesPayload(workspace, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id, options);

    return withRoleCatalog({
      workspace: mapWorkspaceSummary(workspace),
      invites: invites.map((invite) => mapInviteSummary(invite))
    });
  }

  async function listInvites(workspace, options = {}) {
    return listInvitesPayload(workspace, options);
  }

  async function createInvite(workspace, user, payload = {}, options = {}) {
    const email = normalizeLowerText(payload.email);
    const roleSid = normalizeLowerText(payload.roleSid || "member") || "member";
    if (!assignableRoleIds.includes(roleSid)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleSid: "Role is not assignable."
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
        roleSid,
        status: "pending",
        tokenHash,
        invitedByUserId: normalizeRecordId(user?.id, { fallback: null }),
        expiresAt: new Date(Date.now() + resolvedInviteExpiresInMs).toISOString()
      },
      options
    );
    const createdInviteId = normalizeRecordId(createdInvite?.id, { fallback: null });
    if (!createdInviteId) {
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
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      throw new AppError(400, "Validation failed.");
    }

    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(
      normalizedInviteId,
      workspace.id,
      options
    );
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await workspaceInvitesRepository.revokeById(normalizedInviteId, options);
    const revokedInviteId = normalizeRecordId(invite?.id, { fallback: null });
    if (!revokedInviteId) {
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
