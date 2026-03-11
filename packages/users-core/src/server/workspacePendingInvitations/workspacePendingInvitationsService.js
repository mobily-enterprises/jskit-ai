import { resolveInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { authenticatedUserValidator } from "../common/validators/authenticatedUserValidator.js";

function createService({
  workspaceInvitesRepository,
  workspaceMembershipsRepository
} = {}) {
  if (!workspaceInvitesRepository || !workspaceMembershipsRepository) {
    throw new Error("workspacePendingInvitationsService requires invite and membership repositories.");
  }

  function requireAuthenticatedInviteUser(user) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    return normalizedUser;
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

  async function requirePendingInviteForUserByToken(user, token, options = {}) {
    const normalizedUser = requireAuthenticatedInviteUser(user);
    const tokenHash = requireInviteTokenHash(token);

    const invite = await workspaceInvitesRepository.findPendingByTokenHash(tokenHash, options);
    if (!invite) {
      throw new AppError(404, "Invitation not found or already handled.");
    }

    if (normalizeLowerText(invite.email) !== normalizedUser.email) {
      throw new AppError(403, "Invitation email does not match authenticated user.");
    }

    return {
      user: normalizedUser,
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
    const normalizedUser = requireAuthenticatedInviteUser(user);
    if (!normalizedUser.email) {
      return [];
    }

    return workspaceInvitesRepository.listPendingByEmail(normalizedUser.email, options);
  }

  async function acceptInviteByToken({ user, token } = {}, options = {}) {
    const resolvedInvite = await requirePendingInviteForUserByToken(user, token, options);
    await revokeExpiredInviteAndThrow(resolvedInvite.invite, options);

    await workspaceMembershipsRepository.upsertMembership(
      resolvedInvite.invite.workspaceId,
      resolvedInvite.user.id,
      {
        roleId: resolvedInvite.invite.roleId,
        status: "active"
      },
      options
    );
    await workspaceInvitesRepository.markAcceptedById(resolvedInvite.invite.id, options);

    return {
      decision: "accepted"
    };
  }

  async function refuseInviteByToken({ user, token } = {}, options = {}) {
    const resolvedInvite = await requirePendingInviteForUserByToken(user, token, options);
    await revokeExpiredInviteAndThrow(resolvedInvite.invite, options);
    await workspaceInvitesRepository.revokeById(resolvedInvite.invite.id, options);

    return {
      decision: "refused"
    };
  }

  return Object.freeze({
    listPendingInvitesForUser,
    acceptInviteByToken,
    refuseInviteByToken
  });
}

export { createService };
