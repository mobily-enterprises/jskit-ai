import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { resolveInviteTokenHash, buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { OWNER_ROLE_ID, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";

const DEFAULT_LOCALE = "en";

function roleNotAssignableError() {
  return createValidationError({
    roleSid: { code: "workspaces.member.roleNotAssignable", message: "Role is not assignable." }
  });
}

/**
 * @param {object} dependencies
 * @param {import("../types.js").WorkspaceMembershipsRepository} dependencies.workspaceMembershipsRepository
 * @param {import("../types.js").WorkspaceInvitesRepository} dependencies.workspaceInvitesRepository
 * @param {number} dependencies.inviteExpiresInMs
 * @param {import("../types.js").WorkspaceRoleCatalog} dependencies.roleCatalog
 * @param {boolean} dependencies.workspaceInvitationsEnabled
 * @param {(invite: { token: string, invite: object, workspace: object }) => string} dependencies.inviteUrlBuilder
 * @param {import("../types.js").WorkspaceInviteMailer} dependencies.workspaceInviteMailer
 * @param {import("../types.js").WorkspaceInviteEmailTemplate} dependencies.workspaceInviteEmailTemplate
 * @param {ReturnType<typeof import("../i18n.js").createWorkspacesServerI18n>} dependencies.i18n
 * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/users-core/server/types").UserSettingsRepository} dependencies.userSettingsRepository
 */
function createService({
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  inviteExpiresInMs,
  roleCatalog,
  workspaceInvitationsEnabled,
  inviteUrlBuilder,
  workspaceInviteMailer,
  workspaceInviteEmailTemplate,
  i18n,
  userProfilesRepository,
  userSettingsRepository
}) {
  const assignableRoleIds = Array.isArray(roleCatalog.assignableRoleIds)
    ? [...roleCatalog.assignableRoleIds]
    : [];

  function ensureWorkspaceInvitationsEnabled() {
    if (workspaceInvitationsEnabled) {
      return;
    }
    throw new AppError(403, "Workspace invitations are disabled.", { code: "workspaces.invite.disabled" });
  }

  function withRoleCatalog(payload = {}) {
    return {
      ...payload,
      roleCatalog: cloneWorkspaceRoleCatalog({
        ...roleCatalog,
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

  /**
   * A mailer's delivery outcome; the status defaults to "sent".
   * @param {unknown} value
   */
  function normalizeInviteDeliveryResult(value) {
    /** @type {{ status?: string, message?: string, messageCode?: string, messageParams?: object, providerMessageId?: string }} */
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      status: normalizeLowerText(source.status || "sent") || "sent",
      message: normalizeText(source.message),
      ...(source.messageCode
        ? { messageCode: normalizeText(source.messageCode), messageParams: { ...source.messageParams } }
        : {}),
      providerMessageId: normalizeText(source.providerMessageId)
    };
  }

  // The saved locale of an existing account with the invited email, else English.
  // A failed lookup must not stop the invitation, so it also falls back to English.
  async function resolveRecipientLocale(email, options = {}) {
    try {
      const profile = await userProfilesRepository.findByEmail(email, options);
      const settings = profile?.id ? await userSettingsRepository.findByUserId(profile.id, options) : null;
      return normalizeText(settings?.locale) || DEFAULT_LOCALE;
    } catch {
      return DEFAULT_LOCALE;
    }
  }

  async function deliverInviteEmail({ workspace, user, invite, inviteUrl } = {}, options = {}) {
    try {
      const roleLabel = roleCatalog.roles?.find((role) => role.id === invite.roleSid)?.label;
      const locale = await resolveRecipientLocale(invite.email, options);
      const message = await workspaceInviteEmailTemplate({
        email: invite.email,
        inviteUrl,
        workspace: mapWorkspaceSummary(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        ...(roleLabel ? { roleLabel } : {}),
        expiresAt: invite.expiresAt,
        locale,
        t: (key, params) => i18n.t(locale, key, params)
      });
      const result = await workspaceInviteMailer.sendWorkspaceInvite({
        email: invite.email,
        inviteUrl,
        workspace: mapWorkspaceSummary(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        expiresAt: invite.expiresAt,
        locale,
        message
      }, options);
      return normalizeInviteDeliveryResult(result || { status: "sent" });
    } catch {
      return {
        status: "failed",
        // Provider errors can contain the secret invitation URL.
        message: "Unable to send workspace invite email.",
        messageCode: "workspaces.invite.sendFailed",
        messageParams: {},
        providerMessageId: ""
      };
    }
  }

  // Applications read the role catalog and member list as they are; their
  // actions answer with them as JSON:API data.
  async function listRoles(options = {}) {
    return cloneWorkspaceRoleCatalog({
      ...roleCatalog,
      assignableRoleIds
    });
  }

  async function listRolesResponse(options = {}) {
    return returnJsonApiData(await listRoles(options));
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

  async function listMembersResponse(workspace, options = {}) {
    return returnJsonApiData(await listMembersPayload(workspace, options));
  }

  async function updateMemberRole(workspace, payload, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    const roleSid = normalizeLowerText(payload.roleSid || "");
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.", { code: "validation_failed" });
    }
    if (!assignableRoleIds.includes(roleSid)) {
      throw roleNotAssignableError();
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.", { code: "workspaces.member.notFound" });
    }
    if (memberUserId === normalizeRecordId(workspace.ownerUserId, { fallback: null }) || existingMembership.roleSid === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot change workspace owner role.", { code: "workspaces.member.ownerRoleLocked" });
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

    return returnJsonApiData(await listMembersPayload(workspace, options));
  }

  async function removeMember(workspace, payload, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.", { code: "validation_failed" });
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId, options);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.", { code: "workspaces.member.notFound" });
    }
    if (memberUserId === normalizeRecordId(workspace.ownerUserId, { fallback: null }) || existingMembership.roleSid === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot remove workspace owner.", { code: "workspaces.member.ownerNotRemovable" });
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

    return returnJsonApiData(await listMembersPayload(workspace, options));
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
    return returnJsonApiData(await listInvitesPayload(workspace, options));
  }

  async function prepareInvite(workspace, user, payload = {}, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    if (!options.trx) {
      throw new TypeError("prepareInvite requires a managed transaction.");
    }
    const email = normalizeLowerText(payload.email);
    const roleSid = normalizeLowerText(payload.roleSid || "member") || "member";
    if (!assignableRoleIds.includes(roleSid)) {
      throw roleNotAssignableError();
    }

    const token = buildInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + inviteExpiresInMs).toISOString();
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
      throw new AppError(404, "Invite not found or already handled.", { code: "workspaces.invite.notFoundOrHandled" });
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      throw new AppError(409, "Invitation has expired.", { code: "workspaces.invite.expired" });
    }
    const token = Object.hasOwn(prepared, "inviteTokenPreview")
      ? normalizeText(prepared.inviteTokenPreview)
      : encodeInviteTokenHash(invite.tokenHash);
    if (!token || resolveInviteTokenHash(token) !== invite.tokenHash) {
      throw new AppError(400, "Invitation token does not match the saved invitation.", {
        code: "workspaces.invite.tokenMismatch"
      });
    }
    const savedWorkspace = {
      ...workspace,
      id: invite.workspaceId,
      slug: invite.workspaceSlug,
      name: invite.workspaceName,
      avatarUrl: invite.workspaceAvatarUrl
    };
    const inviteUrl = inviteUrlBuilder({ token, invite, workspace: savedWorkspace });
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

  async function createInvite(workspace, user, payload, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    if (options.trx) {
      throw new TypeError("Use prepareInvite inside a transaction, then sendInvite after commit.");
    }
    const prepared = await workspaceInvitesRepository.withTransaction((trx) =>
      prepareInvite(workspace, user, payload, { ...options, trx })
    );
    return returnJsonApiData(await sendInvite(workspace, user, prepared, options));
  }

  async function revokeInvite(workspace, inviteId, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      throw new AppError(400, "Validation failed.", { code: "validation_failed" });
    }

    const revoke = async (trx) => {
      const transactionOptions = { ...options, trx, lock: true, workspaceId: workspace.id };
      const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(
        normalizedInviteId,
        workspace.id,
        transactionOptions
      );
      if (!invite) {
        throw new AppError(404, "Invite not found.", { code: "workspaces.invite.notFound" });
      }
      await workspaceInvitesRepository.revokeById(normalizedInviteId, transactionOptions);
      return normalizeRecordId(invite.id, { fallback: null });
    };
    const revokedInviteId = options.trx
      ? await revoke(options.trx)
      : await workspaceInvitesRepository.withTransaction(revoke);

    const response = await listInvitesPayload(workspace, options);
    return returnJsonApiData({
      ...response,
      revokedInviteId
    });
  }

  return Object.freeze({
    listRoles,
    listRolesResponse,
    listMembers,
    listMembersResponse,
    updateMemberRole,
    removeMember,
    listInvites,
    createInvite,
    prepareInvite,
    sendInvite,
    revokeInvite
  });
}

/** @typedef {ReturnType<typeof createService>} WorkspaceMembersService */

export { createService };
