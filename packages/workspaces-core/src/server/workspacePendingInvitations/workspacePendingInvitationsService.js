import { resolveInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function createService({
  workspaceInvitesRepository,
  workspaceMembershipsRepository
} = {}) {
  if (!workspaceInvitesRepository || !workspaceMembershipsRepository) {
    throw new Error("workspacePendingInvitationsService requires invite and membership repositories.");
  }

  function requireAuthenticatedInviteUser(user) {
    if (!normalizeRecordId(user?.id, { fallback: null })) {
      throw new AppError(401, "Authentication required.");
    }

    return user;
  }

  function requireInviteTokenHash(token) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      throw new AppError(400, "Invite token is required.");
    }

    const tokenHash = resolveInviteTokenHash(normalizedToken);
    if (!tokenHash) {
      throw new AppError(400, "Invite token is invalid.");
    }

    return tokenHash;
  }

  function mapPendingInvite(invite = {}) {
    const id = normalizeRecordId(invite.id, { fallback: null });
    const workspaceId = normalizeRecordId(invite.workspaceId, { fallback: null });
    const tokenHash = normalizeText(invite.tokenHash);

    if (!id || !workspaceId || !tokenHash) {
      return null;
    }

    return {
      id,
      workspaceId,
      workspaceSlug: normalizeText(invite.workspaceSlug),
      workspaceName: normalizeText(invite.workspaceName || invite.workspaceSlug),
      workspaceAvatarUrl: normalizeText(invite.workspaceAvatarUrl),
      roleSid: normalizeLowerText(invite.roleSid || "member") || "member",
      status: normalizeLowerText(invite.status || "pending") || "pending",
      expiresAt: invite.expiresAt || null,
      token: encodeInviteTokenHash(tokenHash)
    };
  }

  async function requirePendingInviteForUserByToken(user, token, options = {}) {
    const actor = requireAuthenticatedInviteUser(user);
    const tokenHash = requireInviteTokenHash(token);

    const invite = await workspaceInvitesRepository.findPendingByTokenHash(tokenHash, options);
    if (!invite) {
      throw new AppError(404, "Invitation not found or already handled.");
    }

    if (normalizeLowerText(invite.email) !== normalizeLowerText(actor?.email)) {
      throw new AppError(403, "Invitation email does not match authenticated user.");
    }

    return {
      user: actor,
      invite
    };
  }

  async function revokeExpiredInviteAndThrow(invite, options = {}) {
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      await workspaceInvitesRepository.revokeById(invite.id, options);
      throw new AppError(409, "Invitation has expired.");
    }
  }

  async function listPendingInvitesForUser(user, options = {}) {
    const actor = requireAuthenticatedInviteUser(user);
    const actorEmail = normalizeLowerText(actor?.email);
    if (!actorEmail) {
      return [];
    }

    const invites = await workspaceInvitesRepository.listPendingByEmail(actorEmail, options);
    return invites.map((invite) => mapPendingInvite(invite)).filter(Boolean);
  }

  function requireWorkspaceIdFromInvite(invite, methodName = "workspacePendingInvitationsService") {
    const workspaceId = normalizeRecordId(invite?.workspaceId, { fallback: null });
    if (!workspaceId) {
      throw new Error(`${methodName} expected invite workspace id.`);
    }
    return workspaceId;
  }

  async function resolveInviteActionInput(user, token, options = {}, methodName = "workspacePendingInvitationsService") {
    const resolvedInvite = await requirePendingInviteForUserByToken(user, token, options);
    await revokeExpiredInviteAndThrow(resolvedInvite.invite, options);

    return {
      resolvedInvite,
      workspaceId: requireWorkspaceIdFromInvite(resolvedInvite.invite, methodName)
    };
  }

  async function acceptInviteByToken({ user, token } = {}, options = {}) {
    const { resolvedInvite, workspaceId } = await resolveInviteActionInput(
      user,
      token,
      options,
      "workspacePendingInvitationsService.acceptInviteByToken"
    );

    await workspaceMembershipsRepository.upsertMembership(
      workspaceId,
      resolvedInvite.user.id,
      {
        roleSid: resolvedInvite.invite.roleSid,
        status: "active"
      },
      options
    );
    await workspaceInvitesRepository.markAcceptedById(resolvedInvite.invite.id, options);

    return {
      decision: "accepted",
      workspaceId
    };
  }

  async function refuseInviteByToken({ user, token } = {}, options = {}) {
    const { resolvedInvite, workspaceId } = await resolveInviteActionInput(
      user,
      token,
      options,
      "workspacePendingInvitationsService.refuseInviteByToken"
    );
    await workspaceInvitesRepository.revokeById(resolvedInvite.invite.id, options);

    return {
      decision: "refused",
      workspaceId
    };
  }

  return Object.freeze({
    listPendingInvitesForUser,
    acceptInviteByToken,
    refuseInviteByToken
  });
}

export { createService };
