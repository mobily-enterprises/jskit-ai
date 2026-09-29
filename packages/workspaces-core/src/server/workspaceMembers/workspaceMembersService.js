import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { resolveInviteTokenHash, buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
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
    } catch {
      return {
        status: "failed",
        // Provider errors can contain the secret invitation URL.
        message: "Unable to send workspace invite email.",
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

  async function prepareInvite(workspace, user, payload = {}, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    if (!options.trx) {
      throw new TypeError("prepareInvite requires a managed transaction.");
    }
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
    await workspaceInvitesRepository.lockWorkspaceForInvitations(workspace.id, options);
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
      throw new Error("workspaceMembersService.prepareInvite expected repository to return created invite id.");
    }

    return { createdInviteId, inviteTokenPreview: token };
  }

  async function sendInvite(workspace, user, prepared = {}, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    if (options.trx) {
      throw new TypeError("sendInvite must run after the invitation transaction commits.");
    }
    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(
      prepared.createdInviteId,
      workspace.id,
      { ...options, includeWorkspace: true, lock: false }
    );
    if (!invite) {
      throw new AppError(404, "Invite not found or already handled.");
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new AppError(409, "Invitation has expired.");
    }
    const token = Object.hasOwn(prepared, "inviteTokenPreview")
      ? normalizeText(prepared.inviteTokenPreview)
      : encodeInviteTokenHash(invite.tokenHash);
    if (!token || resolveInviteTokenHash(token) !== invite.tokenHash) {
      throw new AppError(400, "Invitation token does not match the saved invitation.");
    }
    const savedWorkspace = {
      ...workspace,
      id: invite.workspaceId,
      slug: invite.workspaceSlug,
      name: invite.workspaceName,
      avatarUrl: invite.workspaceAvatarUrl
    };
    const inviteUrl = resolvedInviteUrlBuilder({ token, invite, workspace: savedWorkspace });
    const response = await listInvitesPayload(savedWorkspace, options);
    const inviteDelivery = await deliverInviteEmail({ workspace: savedWorkspace, user, invite, inviteUrl }, options);
    return {
      ...response,
      inviteTokenPreview: token,
      inviteUrl,
      inviteDelivery,
      createdInviteId: normalizeRecordId(invite.id, { fallback: null })
    };
  }

  async function createInvite(workspace, user, payload = {}, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    if (options.trx) {
      throw new TypeError("Use prepareInvite inside a transaction, then sendInvite after commit.");
    }
    const prepared = await workspaceInvitesRepository.withTransaction((trx) =>
      prepareInvite(workspace, user, payload, { ...options, trx })
    );
    return sendInvite(workspace, user, prepared, options);
  }

  async function revokeInvite(workspace, inviteId, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      throw new AppError(400, "Validation failed.");
    }

    const revoke = async (trx) => {
      const transactionOptions = { ...options, trx, lock: true, workspaceId: workspace.id };
      const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(
        normalizedInviteId,
        workspace.id,
        transactionOptions
      );
      if (!invite) {
        throw new AppError(404, "Invite not found.");
      }
      await workspaceInvitesRepository.revokeById(normalizedInviteId, transactionOptions);
      return normalizeRecordId(invite.id, { fallback: null });
    };
    const revokedInviteId = options.trx
      ? await revoke(options.trx)
      : await workspaceInvitesRepository.withTransaction(revoke);

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
    prepareInvite,
    sendInvite,
    revokeInvite
  });
}

export { createService };
