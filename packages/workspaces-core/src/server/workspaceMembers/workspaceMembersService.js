import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { resolveInviteTokenHash, buildInviteToken, hashInviteToken } from "@jskit-ai/auth-core/server/inviteTokens";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { OWNER_ROLE_ID, cloneWorkspaceRoleCatalog } from "../../shared/roles.js";
import {
  buildMailerUnconfiguredDelivery,
  unconfiguredWorkspaceInviteMailer
} from "./unconfiguredWorkspaceInviteMailer.js";

const DEFAULT_LOCALE = "en";
const DEFAULT_TIME_ZONE = "UTC";
// A members or invites list page's size when the request names none, as a client list's first request asks.
const DEFAULT_PAGE_SIZE = 20;

// The page a list request asks for: its size and the cursor of the page before, as the repositories read it.
function listPage({ cursor, limit } = {}) {
  return { size: Number(limit) || DEFAULT_PAGE_SIZE, ...(cursor ? { after: cursor } : {}) };
}

function roleNotAssignableError() {
  return createValidationError({
    roleSid: { code: "workspaces.member.roleNotAssignable", message: "Role is not assignable." }
  });
}

function memberUserIdRequiredError() {
  return createValidationError({
    memberUserId: { code: "workspaces.member.userIdRequired", message: "Member user id is required." }
  });
}

function inviteIdRequiredError() {
  return createValidationError({
    inviteId: { code: "workspaces.invite.idRequired", message: "Invite id is required." }
  });
}

/**
 * @param {object} dependencies
 * @param {import("../types.js").WorkspaceMembershipsRepository} dependencies.workspaceMembershipsRepository
 * @param {import("../types.js").WorkspaceMemberPagesRepository} dependencies.workspaceMemberPagesRepository
 * @param {import("../types.js").WorkspaceInvitesRepository} dependencies.workspaceInvitesRepository
 * @param {number} dependencies.inviteExpiresInMs
 * @param {import("../types.js").WorkspaceRoleCatalog} dependencies.roleCatalog
 * @param {boolean} dependencies.workspaceInvitationsEnabled
 * @param {import("../types.js").WorkspaceInviteUrlBuilder} dependencies.inviteUrlBuilder
 * @param {import("../types.js").WorkspaceInviteMailer} dependencies.workspaceInviteMailer
 *   The provided `workspaces.invite-mailer`, or unconfiguredWorkspaceInviteMailer when no feature provides one.
 * @param {import("../types.js").WorkspaceInviteEmailTemplate} dependencies.workspaceInviteEmailTemplate
 * @param {import("../types.js").WorkspacesServerI18n} dependencies.i18n
 * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("@jskit-ai/users-core/server/types").UserSettingsRepository} dependencies.userSettingsRepository
 */
function createService({
  workspaceMembershipsRepository,
  workspaceMemberPagesRepository,
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
  const { assignableRoleIds } = roleCatalog;
  const inviteMailerProvided = workspaceInviteMailer !== unconfiguredWorkspaceInviteMailer;

  function ensureWorkspaceInvitationsEnabled() {
    if (workspaceInvitationsEnabled) {
      return;
    }
    throw new AppError(403, "Workspace invitations are disabled.", { code: "workspaces.invite.disabled" });
  }

  function withRoleCatalog(payload) {
    return {
      ...payload,
      roleCatalog: cloneWorkspaceRoleCatalog(roleCatalog)
    };
  }

  // The workspace as the members, invites and invitation email show it.
  function mapMembersWorkspace(workspace) {
    return {
      id: normalizeRecordId(workspace.id, { fallback: "" }),
      slug: normalizeText(workspace.slug),
      name: normalizeText(workspace.name),
      ownerUserId: normalizeRecordId(workspace.ownerUserId, { fallback: "" }),
      avatarUrl: normalizeText(workspace.avatarUrl)
    };
  }

  function mapMemberSummary(member, workspace) {
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

  function mapInviteSummary(invite) {
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

  // The saved locale and time zone of an existing account with the invited email,
  // else English and UTC. A failed lookup must not stop the invitation, so it also
  // falls back to them.
  async function resolveRecipientSettings(email, options = {}) {
    try {
      const profile = await userProfilesRepository.findByEmail(email, options);
      const settings = profile?.id ? await userSettingsRepository.findByUserId(profile.id, options) : null;
      return {
        locale: normalizeText(settings?.locale) || DEFAULT_LOCALE,
        timeZone: normalizeText(settings?.timeZone) || DEFAULT_TIME_ZONE
      };
    } catch {
      return { locale: DEFAULT_LOCALE, timeZone: DEFAULT_TIME_ZONE };
    }
  }

  async function deliverInviteEmail({ workspace, user, invite, inviteUrl }, options) {
    // With no mailer provided there is nothing to send, so the recipient's
    // locale is not looked up and no email is rendered.
    if (!inviteMailerProvided) {
      return buildMailerUnconfiguredDelivery();
    }
    try {
      const roleLabel = roleCatalog.roles.find((role) => role.id === invite.roleSid)?.label;
      const { locale, timeZone } = await resolveRecipientSettings(invite.email, options);
      const message = await workspaceInviteEmailTemplate({
        email: invite.email,
        inviteUrl,
        workspace: mapMembersWorkspace(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        ...(roleLabel ? { roleLabel } : {}),
        expiresAt: invite.expiresAt,
        locale,
        timeZone,
        t: (key, params) => i18n.t(locale, key, params)
      });
      const result = await workspaceInviteMailer.sendWorkspaceInvite({
        email: invite.email,
        inviteUrl,
        workspace: mapMembersWorkspace(workspace),
        inviter: user || null,
        roleSid: invite.roleSid,
        expiresAt: invite.expiresAt,
        locale,
        message
      }, options);
      return normalizeInviteDeliveryResult(result);
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

  // Applications read the role catalog and member list as they are; the
  // *Response methods answer with them as JSON:API data, for the actions. The actions' members and invites lists answer
  // a page at a time: `query` names its size (`limit`, 20 when none) and the `nextCursor` of the page before (`cursor`).
  async function listRoles() {
    return cloneWorkspaceRoleCatalog(roleCatalog);
  }

  async function listRolesResponse() {
    return returnJsonApiData(await listRoles());
  }

  // Every active member of the workspace, for work that needs them all, such as a delivery's recipients.
  async function listMembers(workspace, options = {}) {
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id, options);

    return withRoleCatalog({
      workspace: mapMembersWorkspace(workspace),
      members: members.map((member) => mapMemberSummary(member, workspace))
    });
  }

  /**
   * One page of the workspace's active members, by display name, and the `nextCursor` of the page after (null on the
   * last page): the members list a screen shows.
   * @param {object} workspace
   * @param {{ cursor?: string, limit?: number }} [query]
   * @param {object} [options]
   */
  async function listMembersPage(workspace, query = {}, options = {}) {
    const page = await workspaceMemberPagesRepository.listActivePage(workspace.id, listPage(query), options);

    return withRoleCatalog({
      workspace: mapMembersWorkspace(workspace),
      members: page.members.map((member) => mapMemberSummary(member, workspace)),
      nextCursor: page.next
    });
  }

  // One active member's summary, the same as their listMembers entry, or null for a removed or
  // unknown member. It reads one membership, so a per-member lookup costs the same in any workspace.
  async function getMember(workspace, userId, options = {}) {
    const member = await workspaceMembershipsRepository.findActiveByWorkspaceIdAndUserId(workspace.id, userId, options);
    return member ? mapMemberSummary(member, workspace) : null;
  }

  async function listMembersResponse(workspace, query = {}, options = {}) {
    return returnJsonApiData(await listMembersPage(workspace, query, options));
  }

  // Changes an active member who is not the owner, and answers the members' first page. The membership is locked before it is
  // checked, so a role change and a removal of one member at once run one after the other, and the second decides on
  // what the first left: a removed member is not made active again by a role change, and keeps the role they had.
  async function changeActiveMember(workspace, memberUserId, { ownerError, changes }, options) {
    await workspaceMembershipsRepository.withTransaction(options, async (txOptions) => {
      const membership = await workspaceMembershipsRepository.lockByWorkspaceIdAndUserId(workspace.id, memberUserId, txOptions);
      if (!membership || membership.status !== "active") {
        throw new AppError(404, "Member not found.", { code: "workspaces.member.notFound" });
      }
      if (memberUserId === normalizeRecordId(workspace.ownerUserId, { fallback: null }) || membership.roleSid === OWNER_ROLE_ID) {
        throw ownerError();
      }
      await workspaceMembershipsRepository.upsertMembership(workspace.id, memberUserId, changes(membership), txOptions);
    });

    return returnJsonApiData(await listMembersPage(workspace, {}, options));
  }

  async function updateMemberRole(workspace, payload, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    const roleSid = normalizeLowerText(payload.roleSid || "");
    if (!memberUserId) {
      throw memberUserIdRequiredError();
    }
    if (!assignableRoleIds.includes(roleSid)) {
      throw roleNotAssignableError();
    }

    return changeActiveMember(workspace, memberUserId, {
      ownerError: () => new AppError(409, "Cannot change workspace owner role.", { code: "workspaces.member.ownerRoleLocked" }),
      changes: () => ({ roleSid, status: "active" })
    }, options);
  }

  async function removeMember(workspace, payload, options = {}) {
    const memberUserId = normalizeRecordId(payload.memberUserId, { fallback: null });
    if (!memberUserId) {
      throw memberUserIdRequiredError();
    }

    return changeActiveMember(workspace, memberUserId, {
      ownerError: () => new AppError(409, "Cannot remove workspace owner.", { code: "workspaces.member.ownerNotRemovable" }),
      changes: (membership) => ({ roleSid: membership.roleSid, status: "revoked" })
    }, options);
  }

  // One page of the workspace's pending invites, newest first, and the nextCursor of the page after.
  async function listInvitesPayload(workspace, query, options) {
    ensureWorkspaceInvitationsEnabled();
    const page = await workspaceInvitesRepository.listPendingPageByWorkspaceId(workspace.id, listPage(query), options);

    return withRoleCatalog({
      workspace: mapMembersWorkspace(workspace),
      invites: page.invites.map((invite) => mapInviteSummary(invite)),
      nextCursor: page.next
    });
  }

  async function listInvitesResponse(workspace, query = {}, options = {}) {
    return returnJsonApiData(await listInvitesPayload(workspace, query, options));
  }

  async function prepareInvite(workspace, user, payload, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const email = normalizeLowerText(payload.email);
    const roleSid = normalizeLowerText(payload.roleSid || "member") || "member";
    if (!assignableRoleIds.includes(roleSid)) {
      throw roleNotAssignableError();
    }

    const token = buildInviteToken();
    const tokenHash = hashInviteToken(token);
    const expiresAt = new Date(Date.now() + inviteExpiresInMs).toISOString();
    // The caller's managed transaction: the lock refuses a call outside one.
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

  // The committed pending invitation, read in a transaction of its own: one inside the caller's is refused, since
  // delivery runs after the invitation's transaction commits.
  function readInviteToDeliver(workspace, prepared, options) {
    return workspaceInvitesRepository.withTransaction({ ...options, outermost: true }, (txOptions) =>
      workspaceInvitesRepository.findPendingByIdForWorkspace(
        prepared.createdInviteId,
        workspace.id,
        { ...txOptions, includeWorkspace: true, lock: false }
      ));
  }

  async function sendInvite(workspace, user, prepared, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const invite = await readInviteToDeliver(workspace, prepared, options);
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
    const response = await listInvitesPayload(savedWorkspace, {}, options);
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
    // Preparation commits before delivery, so a call inside the caller's transaction is refused: use prepareInvite
    // inside it, then sendInvite after its commit.
    const prepared = await workspaceInvitesRepository.withTransaction({ ...options, outermost: true }, (txOptions) =>
      prepareInvite(workspace, user, payload, txOptions)
    );
    return returnJsonApiData(await sendInvite(workspace, user, prepared, options));
  }

  async function revokeInvite(workspace, inviteId, options = {}) {
    ensureWorkspaceInvitationsEnabled();
    const normalizedInviteId = normalizeRecordId(inviteId, { fallback: null });
    if (!normalizedInviteId) {
      throw inviteIdRequiredError();
    }

    const revoke = async (txOptions) => {
      const transactionOptions = { ...txOptions, lock: true, workspaceId: workspace.id };
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
    const revokedInviteId = await workspaceInvitesRepository.withTransaction(options, revoke);

    const response = await listInvitesPayload(workspace, {}, options);
    return returnJsonApiData({
      ...response,
      revokedInviteId
    });
  }

  /**
   * The user an invite's email belongs to, as a list of their id, or none
   * before that person signs up: the users an invite's realtime change reaches.
   * @param {unknown} inviteId
   * @param {object} [options]
   * @returns {Promise<string[]>}
   */
  async function inviteRecipientUserIds(inviteId, options = {}) {
    const invite = await workspaceInvitesRepository.findById(inviteId, options);
    const recipient = invite?.email ? await userProfilesRepository.findByEmail(invite.email, options) : null;
    return recipient?.id ? [recipient.id] : [];
  }

  return Object.freeze({
    listRoles,
    listRolesResponse,
    listMembers,
    listMembersPage,
    getMember,
    listMembersResponse,
    updateMemberRole,
    removeMember,
    listInvitesResponse,
    createInvite,
    prepareInvite,
    sendInvite,
    revokeInvite,
    inviteRecipientUserIds
  });
}

export { createService };
