import { deliverMessage, markStagingEmail } from "@jskit-ai/kernel/server/runtime/appEnvironment";

/**
 * The provided `workspaces.invite-mailer`, sending as APP_ENV says (`deliverMessage`). Production sends each
 * invitation to its address. Staging sends it only to STAGING_EMAIL_TO, its message showing the address it was for
 * (`markStagingEmail`). Otherwise, in development, test and staging without STAGING_EMAIL_TO, it logs the
 * invitation's recipient, subject and link and reports the delivery `simulated`, so the inviter copies the link to
 * share it.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("../types.js").WorkspaceInviteMailer} dependencies.mailer The provided mailer.
 * @returns {import("../types.js").WorkspaceInviteMailer}
 */
function createAppEnvironmentInviteMailer({ env, logger, mailer }) {
  async function sendWorkspaceInvite(invite, options) {
    const delivery = await deliverMessage({
      env,
      logger,
      channel: "email",
      to: invite.email,
      summary: `the workspace invitation email to ${invite.email}`,
      details: { subject: String(invite.message?.subject || ""), inviteUrl: invite.inviteUrl },
      send: (to, { originalTo }) => mailer.sendWorkspaceInvite(
        { ...invite, email: to, message: markStagingEmail(invite.message, originalTo) },
        options
      )
    });
    if (delivery.sent) {
      return delivery.result;
    }
    return {
      status: "simulated",
      message: "Outside production the invitation email was logged, not sent. Copy the invite link to share it.",
      messageCode: "workspaces.invite.simulated",
      messageParams: {},
      providerMessageId: ""
    };
  }

  return Object.freeze({ sendWorkspaceInvite });
}

export { createAppEnvironmentInviteMailer };
