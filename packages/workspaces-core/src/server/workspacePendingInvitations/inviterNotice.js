import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { escapeHtml } from "../workspaceMembers/defaultWorkspaceInviteEmail.js";

const DEFAULT_LOCALE = "en";

/**
 * The email telling an inviter that an account with another address accepted their invitation, in their language.
 * @param {{ acceptance: import("../types.js").WorkspaceInviteAcceptance, t: (key: string, params?: object) => string }} input
 */
function renderInviteAcceptedByOtherAddressEmail({ acceptance, t }) {
  const { invite, user, workspace } = acceptance;
  const params = {
    member: user.displayName || user.email,
    memberEmail: user.email,
    invitedEmail: invite.email,
    workspace: workspace.name || workspace.slug
  };
  const paragraphs = [
    t("jskit.workspaces.inviteAcceptedEmail.body", params),
    t("jskit.workspaces.inviteAcceptedEmail.review", params)
  ];
  return {
    subject: t("jskit.workspaces.inviteAcceptedEmail.subject", params),
    text: paragraphs.join("\n\n"),
    html: paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n")
  };
}

/**
 * Tells an invitation's inviter that an account whose email is not the invited address accepted it, through the
 * invite mailer's optional `sendInviteAcceptedByOtherAddress`, once the acceptance committed. Without that method,
 * or without an inviter (one whose account is gone), nothing is sent. The acceptance stands whatever happens here: a
 * failure is logged.
 * @param {object} dependencies
 * @param {import("../types.js").WorkspaceInviteMailer} dependencies.inviteMailer
 * @param {import("@jskit-ai/users-core/server/types").UsersProfiles} dependencies.userProfiles
 * @param {import("@jskit-ai/users-core/server/types").UsersSettings} dependencies.userSettings
 * @param {import("../types.js").WorkspacesServerI18n} dependencies.i18n
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @returns {(acceptance: import("../types.js").WorkspaceInviteAcceptance, options?: object) => Promise<void>}
 */
function createInviterNotice({ inviteMailer, userProfiles, userSettings, i18n, logger }) {
  // readable-check: allow method-probe - optional operation: sendInviteAcceptedByOtherAddress is an optional workspaces.invite-mailer operation
  if (typeof inviteMailer.sendInviteAcceptedByOtherAddress !== "function") {
    return async function notifyNoInviter() {};
  }

  return async function notifyInviter(acceptance, options = {}) {
    const { invite, user, workspace } = acceptance;
    try {
      const inviter = invite.invitedByUserId ? await userProfiles.findById(invite.invitedByUserId, options) : null;
      if (!inviter?.email) {
        return;
      }
      const settings = await userSettings.findByUserId(inviter.id, options);
      const locale = normalizeText(settings?.locale) || DEFAULT_LOCALE;
      await inviteMailer.sendInviteAcceptedByOtherAddress({
        inviteId: invite.id,
        invite: { id: invite.id, email: invite.email, roleSid: invite.roleSid },
        inviter: { id: inviter.id, email: inviter.email, displayName: normalizeText(inviter.displayName) },
        member: { id: user.id, email: user.email, displayName: user.displayName },
        workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
        locale,
        message: renderInviteAcceptedByOtherAddressEmail({ acceptance, t: (key, params) => i18n.t(locale, key, params) })
      }, options);
    } catch (error) {
      logger.warn(
        { error, inviteId: invite.id, workspaceId: workspace.id },
        "The inviter was not told that another address accepted their invitation."
      );
    }
  };
}

export { createInviterNotice, renderInviteAcceptedByOtherAddressEmail };
