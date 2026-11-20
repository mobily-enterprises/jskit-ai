import { resolveInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * @param {object} dependencies
 * @param {import("../types.js").WorkspaceInvitesRepository} dependencies.workspaceInvitesRepository
 * @param {import("../types.js").WorkspaceMembershipsRepository} dependencies.workspaceMembershipsRepository
 * @param {import("../types.js").WorkspacesRepository} dependencies.workspacesRepository
 * @param {import("../types.js").WorkspaceSettingsRepository} dependencies.workspaceSettingsRepository
 * @param {import("../types.js").WorkspaceRoleCatalog} dependencies.roleCatalog
 * @param {import("../types.js").WorkspaceInviteAcceptanceParticipant} dependencies.acceptanceParticipant
 * @param {boolean} dependencies.invitationsAnyAccount Whether any signed-in account may accept an invitation
 *   (config.workspaceInvitations.anyAccount), unless its workspace requires the invited address.
 * @param {(acceptance: import("../types.js").WorkspaceInviteAcceptance, options: object) => Promise<void>} dependencies.notifyInviter
 *   Tells the inviter that another address accepted their invitation, after the acceptance committed.
 */
function createService({
  workspaceInvitesRepository,
  workspaceMembershipsRepository,
  workspacesRepository,
  workspaceSettingsRepository,
  roleCatalog,
  acceptanceParticipant,
  invitationsAnyAccount,
  notifyInviter
}) {
  function roleLabelMetadata(roleSid) {
    const role = roleCatalog.roles.find((entry) => entry.id === (normalizeLowerText(roleSid || "member") || "member"));
    const label = typeof role?.label === "string" ? role.label.trim() : "";
    return label ? { roleLabel: label } : {};
  }

  // Acceptance and refusal own their transaction (outermost): related writes belong in the acceptance participant.
  async function withInviteTransaction(user, token, decision, options, work) {
    // Locate outside the transaction to avoid a stale MySQL repeatable-read
    // snapshot. The callback validates again under the workspace/invite locks.
    const initial = await requirePendingInviteForUserByToken(user, token, decision, options);
    // work receives the locking options its repository reads take, and the transaction's own options.
    const result = await workspaceInvitesRepository.withTransaction({ ...options, outermost: true }, (txOptions) => work({
      ...txOptions,
      lock: true,
      workspaceId: initial.invite.workspaceId,
      inviteId: initial.invite.id
    }, txOptions));
    // Commit the invitation's expiry before reporting the rejection.
    if (result.expired) {
      throw Object.assign(invitationExpiredError(), { transactionOutcome: "committed" });
    }
    return result;
  }

  function invitationExpiredError() {
    return new AppError(409, "Invitation has expired.", { code: "workspaces.invite.expired" });
  }

  function sameEmail(left, right) {
    return normalizeLowerText(left) === normalizeLowerText(right);
  }

  // Whether only the invitation's own address may accept it: always without anyAccount, else as its workspace says.
  async function requiresSameEmail(workspaceId, options) {
    return !invitationsAnyAccount || workspaceSettingsRepository.findInvitesRequireSameEmail(workspaceId, options);
  }

  function requireAuthenticatedInviteUser(user) {
    if (!normalizeRecordId(user?.id, { fallback: null })) {
      throw new AppError(401, "Authentication required.", { code: "workspaces.auth.required" });
    }

    return user;
  }

  function requireInviteTokenHash(token) {
    const normalizedToken = normalizeText(token);
    if (!normalizedToken) {
      throw new AppError(400, "Invite token is required.", { code: "workspaces.invite.tokenRequired" });
    }

    const tokenHash = resolveInviteTokenHash(normalizedToken);
    if (!tokenHash) {
      throw new AppError(400, "Invite token is invalid.", { code: "workspaces.invite.tokenInvalid" });
    }

    return tokenHash;
  }

  function maskInviteEmail(email) {
    const normalizedEmail = normalizeLowerText(email);
    const [localPart = "", domain = ""] = normalizedEmail.split("@");
    if (!localPart || !domain) {
      return "";
    }
    const visibleLocal = localPart.length <= 2 ? localPart[0] || "" : localPart.slice(0, 2);
    return `${visibleLocal}${"*".repeat(Math.max(localPart.length - visibleLocal.length, 1))}@${domain}`;
  }

  function resolvePublicInviteStatus(invite) {
    if (!invite) {
      return "not_found";
    }
    const status = normalizeLowerText(invite.status || "pending") || "pending";
    if (status === "pending" && invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return "expired";
    }
    if (["accepted", "revoked", "expired"].includes(status)) {
      return status;
    }
    return "pending";
  }

  function mapResolvedInvite(invite, token) {
    const status = resolvePublicInviteStatus(invite);
    if (!invite) {
      return {
        id: "not-found",
        token: normalizeText(token),
        status,
        email: "",
        maskedEmail: "",
        roleSid: "",
        expiresAt: null,
        requiresSameEmail: true,
        workspace: {
          id: "",
          slug: "",
          name: "",
          avatarUrl: ""
        }
      };
    }

    return {
      id: normalizeRecordId(invite.id, { fallback: "" }),
      token: normalizeText(token),
      status,
      email: normalizeLowerText(invite.email),
      maskedEmail: maskInviteEmail(invite.email),
      roleSid: normalizeLowerText(invite.roleSid || "member") || "member",
      ...roleLabelMetadata(invite.roleSid),
      expiresAt: invite.expiresAt || null,
      requiresSameEmail: invite.requiresSameEmail,
      workspace: {
        id: normalizeRecordId(invite.workspaceId, { fallback: "" }),
        slug: normalizeText(invite.workspaceSlug),
        name: normalizeText(invite.workspaceName || invite.workspaceSlug),
        avatarUrl: normalizeText(invite.workspaceAvatarUrl)
      }
    };
  }

  function mapPendingInvite(invite) {
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
      ...roleLabelMetadata(invite.roleSid),
      status: normalizeLowerText(invite.status || "pending") || "pending",
      expiresAt: invite.expiresAt || null,
      token: encodeInviteTokenHash(tokenHash)
    };
  }

  /**
   * The pending invitation the token names and the signed-in user who decides it. None is 404, or 409 expired for an
   * invitation that expired. The invited address decides it; another account only accepts it, only with anyAccount
   * and only where its workspace does not require the invited address (403 otherwise), and only once it confirmed it
   * joins as itself: `acceptAs` is its own email (409 workspaces.invite.differentEmailUnconfirmed otherwise).
   * @param {object} user
   * @param {string} token
   * @param {{ decision: "accept" | "refuse", acceptAs?: string }} decision
   * @param {object} [options]
   */
  async function requirePendingInviteForUserByToken(user, token, { decision, acceptAs }, options = {}) {
    const actor = requireAuthenticatedInviteUser(user);
    const tokenHash = requireInviteTokenHash(token);

    const invite = await workspaceInvitesRepository.findPendingByTokenHash(tokenHash, options);
    if (!invite) {
      if ((await workspaceInvitesRepository.findByTokenHash(tokenHash, options))?.status === "expired") {
        throw invitationExpiredError();
      }
      throw new AppError(404, "Invitation not found or already handled.", {
        code: "workspaces.invite.invitationNotFoundOrHandled"
      });
    }

    if (!sameEmail(invite.email, actor.email)) {
      if (decision !== "accept" || await requiresSameEmail(invite.workspaceId, options)) {
        throw new AppError(403, "Invitation email does not match authenticated user.", {
          code: "workspaces.invite.emailMismatchUser"
        });
      }
      if (!sameEmail(acceptAs, actor.email)) {
        const params = { email: normalizeLowerText(actor.email), maskedEmail: maskInviteEmail(invite.email) };
        throw new AppError(409, `This invitation was sent to ${params.maskedEmail}. Confirm that you want to join as ${params.email}.`, {
          code: "workspaces.invite.differentEmailUnconfirmed",
          params
        });
      }
    }

    return {
      user: actor,
      invite
    };
  }

  async function listPendingInvitesForUser(user, options = {}) {
    const actor = requireAuthenticatedInviteUser(user);
    const actorEmail = normalizeLowerText(actor.email);
    if (!actorEmail) {
      return [];
    }

    const invites = await workspaceInvitesRepository.listPendingByEmail(actorEmail, options);
    return invites.map(mapPendingInvite).filter(Boolean);
  }

  // The bootstrap reads the pending invitations as they are; the action answers
  // with them as JSON:API data.
  async function listPendingInvitesResponse(user, options = {}) {
    return returnJsonApiData({ pendingInvites: await listPendingInvitesForUser(user, options) });
  }

  async function findInviteByToken(token, options = {}) {
    const tokenHash = requireInviteTokenHash(token);
    const invite = await workspaceInvitesRepository.findByTokenHashWithWorkspace(tokenHash, options);

    return mapResolvedInvite(
      invite && { ...invite, requiresSameEmail: await requiresSameEmail(invite.workspaceId, options) },
      token
    );
  }

  async function resolveInviteByToken(token, options = {}) {
    return returnJsonApiData(await findInviteByToken(token, options));
  }

  /**
   * The invitation a registration or a sign-in carries, for the auth provider: refused when it is not pending, and
   * when it was sent to another address unless any account may accept it there. Its `email` is always the
   * invitation's own, so an account registering with another address still confirms it.
   * @param {{ token: string, email: string }} invitation
   * @param {object} [options]
   */
  async function resolveInviteContextForAuth({ token, email }, options = {}) {
    const resolved = await findInviteByToken(token, options);
    if (resolved.status !== "pending") {
      throw new AppError(409, "Invitation is not available.", { code: "workspaces.invite.notAvailable" });
    }
    if (!sameEmail(resolved.email, email) && resolved.requiresSameEmail) {
      throw new AppError(403, "Invitation email does not match account email.", {
        code: "workspaces.invite.emailMismatchAccount"
      });
    }

    return {
      token: resolved.token,
      workspaceId: resolved.workspace.id,
      workspaceSlug: resolved.workspace.slug,
      workspaceName: resolved.workspace.name,
      email: resolved.email,
      roleSid: resolved.roleSid,
      expiresAt: resolved.expiresAt
    };
  }

  function requireWorkspaceIdFromInvite(invite, methodName) {
    const workspaceId = normalizeRecordId(invite.workspaceId, { fallback: null });
    if (!workspaceId) {
      throw new Error(`${methodName} expected invite workspace id.`);
    }
    return workspaceId;
  }

  async function resolveInviteActionInput(user, token, decision, options, methodName) {
    const resolvedInvite = await requirePendingInviteForUserByToken(user, token, decision, options);
    if (resolvedInvite.invite.expiresAt && new Date(resolvedInvite.invite.expiresAt).getTime() < Date.now()) {
      await workspaceInvitesRepository.markExpiredById(resolvedInvite.invite.id, options);
      return { expired: true };
    }

    return {
      resolvedInvite,
      workspaceId: requireWorkspaceIdFromInvite(resolvedInvite.invite, methodName)
    };
  }

  // What an acceptance tells its participant and, when another address accepted, the inviter: the invitation and the
  // user as read (the fields named here always), and the workspace they join.
  function describeAcceptance(invite, user, workspace) {
    return Object.freeze({
      invite: Object.freeze({
        ...invite,
        id: normalizeRecordId(invite.id, { fallback: "" }),
        email: normalizeLowerText(invite.email),
        workspaceId: normalizeRecordId(invite.workspaceId, { fallback: "" }),
        invitedByUserId: normalizeRecordId(invite.invitedByUserId, { fallback: null }),
        roleSid: normalizeLowerText(invite.roleSid || "member") || "member"
      }),
      user: Object.freeze({
        ...user,
        id: normalizeRecordId(user.id, { fallback: "" }),
        email: normalizeLowerText(user.email),
        displayName: normalizeText(user.displayName)
      }),
      workspace: Object.freeze({
        id: normalizeRecordId(workspace.id, { fallback: "" }),
        slug: normalizeText(workspace.slug),
        name: normalizeText(workspace.name || workspace.slug),
        ownerUserId: normalizeRecordId(workspace.ownerUserId, { fallback: "" })
      })
    });
  }

  /**
   * Accepts the invitation the token names for the signed-in user, in one transaction of its own: the membership,
   * the acceptance participant's writes and the invitation's state commit or roll back together. When the user's
   * email is not the invited one (see requirePendingInviteForUserByToken), the inviter is told once it committed.
   * @param {{ user: object, token: string, acceptAs?: string }} input
   * @param {object} [options]
   */
  async function acceptInviteByToken({ user, token, acceptAs }, options = {}) {
    const decision = { decision: "accept", acceptAs };
    const accepted = await withInviteTransaction(user, token, decision, options, async (transactionOptions, txOptions) => {
      const resolved = await resolveInviteActionInput(
        user,
        token,
        decision,
        transactionOptions,
        "workspacePendingInvitationsService.acceptInviteByToken"
      );
      if (resolved.expired) {
        return resolved;
      }
      const { resolvedInvite, workspaceId } = resolved;
      await workspaceMembershipsRepository.upsertMembership(
        workspaceId,
        resolvedInvite.user.id,
        { roleSid: resolvedInvite.invite.roleSid, status: "active", acceptedInviteId: resolvedInvite.invite.id },
        transactionOptions
      );
      const workspace = await workspacesRepository.findById(workspaceId, txOptions);
      const acceptance = describeAcceptance(resolvedInvite.invite, resolvedInvite.user, workspace);
      // Repository locking options stay internal to this service: the participant gets the transaction's own options.
      await acceptanceParticipant(acceptance, txOptions);
      await workspaceInvitesRepository.markAcceptedById(resolvedInvite.invite.id, transactionOptions);
      return { decision: "accepted", workspaceId, acceptance };
    });
    const { acceptance, ...answer } = accepted;
    if (acceptance.invite.email !== acceptance.user.email) {
      await notifyInviter(acceptance, options);
    }
    return answer;
  }

  async function refuseInviteByToken({ user, token }, options = {}) {
    const decision = { decision: "refuse" };
    return withInviteTransaction(user, token, decision, options, async (transactionOptions) => {
      const resolved = await resolveInviteActionInput(
        user,
        token,
        decision,
        transactionOptions,
        "workspacePendingInvitationsService.refuseInviteByToken"
      );
      if (resolved.expired) {
        return resolved;
      }
      const { resolvedInvite, workspaceId } = resolved;
      await workspaceInvitesRepository.revokeById(resolvedInvite.invite.id, transactionOptions);
      return { decision: "refused", workspaceId };
    });
  }

  // Accepts the invitation a token names when the user decided "accept", and refuses it otherwise.
  async function redeemInviteByToken(user, { token, decision, acceptAs }, options = {}) {
    return returnJsonApiData(decision === "accept"
      ? await acceptInviteByToken({ user, token, acceptAs }, options)
      : await refuseInviteByToken({ user, token }, options));
  }

  return Object.freeze({
    resolveInviteByToken,
    resolveInviteContextForAuth,
    listPendingInvitesForUser,
    listPendingInvitesResponse,
    acceptInviteByToken,
    refuseInviteByToken,
    redeemInviteByToken
  });
}

export { createService };
