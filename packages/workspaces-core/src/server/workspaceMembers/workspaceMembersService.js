import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { OWNER_ROLE_ID, createWorkspaceRoleCatalog, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";
import { renderDefaultWorkspaceInviteEmail } from "./defaultWorkspaceInviteEmail.js";

function createService({
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  inviteExpiresInMs,
  roleCatalog = null,
  workspaceInvitationsEnabled = true,
  inviteUrlBuilder = null,
  workspaceInviteMailer = null,
  workspaceInviteEmailTemplate = renderDefaultWorkspaceInviteEmail
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
  const resolvedInviteUrlBuilder = typeof inviteUrlBuilder === "function"
    ? inviteUrlBuilder
    : ({ token }) => `/invite/${encodeURIComponent(String(token || "").trim())}`;
  const resolvedWorkspaceInviteMailer =
    workspaceInviteMailer && typeof workspaceInviteMailer === "object" ? workspaceInviteMailer : null;
  const resolvedWorkspaceInviteEmailTemplate =
    typeof workspaceInviteEmailTemplate === "function"
      ? workspaceInviteEmailTemplate
      : renderDefaultWorkspaceInviteEmail;

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

  function normalizeInviteDeliveryResult(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      status: normalizeLowerText(source.status || "sent") || "sent",
      message: normalizeText(source.message),
      providerMessageId: normalizeText(source.providerMessageId)
    };
  }

  async function deliverInviteEmail({ workspace, user, invite, inviteUrl } = {}, options = {}) {
    if (!resolvedWorkspaceInviteMailer || typeof resolvedWorkspaceInviteMailer.sendWorkspaceInvite !== "function") {
      return {
        status: "mailer_unconfigured",
        message: "No workspace invite mailer is configured.",
        providerMessageId: ""
      };
    }

    try {
      const message = await resolvedWorkspaceInviteEmailTemplate({
        email: invite.email,
        inviteUrl,
        workspace: mapWorkspaceSummary(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        expiresAt: invite.expiresAt
      });
      const result = await resolvedWorkspaceInviteMailer.sendWorkspaceInvite({
        email: invite.email,
        inviteUrl,
        workspace: mapWorkspaceSummary(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        expiresAt: invite.expiresAt,
        message
      }, options);
      return normalizeInviteDeliveryResult(result || { status: "sent" });
    } catch (error) {
      return {
        status: "failed",
        message: normalizeText(error?.message || "Unable to send workspace invite email."),
        providerMessageId: ""
      };
    }
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
    ensureWorkspaceInvitationsEnabled();
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
    const expiresAt = new Date(Date.now() + resolvedInviteExpiresInMs).toISOString();
    await workspaceInvitesRepository.expirePendingByWorkspaceIdAndEmail(workspace.id, email, options);
    const createdInvite = await workspaceInvitesRepository.insert(
      {
        workspaceId: workspace.id,
        email,
        roleSid,
        status: "pending",
        tokenHash,
        invitedByUserId: normalizeRecordId(user?.id, { fallback: null }),
        expiresAt
      },
      options
    );
    const createdInviteId = normalizeRecordId(createdInvite?.id, { fallback: null });
    if (!createdInviteId) {
      throw new Error("workspaceMembersService.createInvite expected repository to return created invite id.");
    }

    const response = await listInvitesPayload(workspace, options);
    const inviteUrl = resolvedInviteUrlBuilder({
      token,
      invite: createdInvite,
      workspace
    });
    const inviteDelivery = await deliverInviteEmail({
      workspace,
      user,
      invite: {
        ...createdInvite,
        email,
        roleSid,
        expiresAt: createdInvite?.expiresAt || expiresAt
      },
      inviteUrl
    }, options);
    return {
      ...response,
      inviteTokenPreview: token,
      inviteUrl,
      inviteDelivery,
      createdInviteId
    };
  }

  async function revokeInvite(workspace, inviteId, options = {}) {
    ensureWorkspaceInvitationsEnabled();
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
