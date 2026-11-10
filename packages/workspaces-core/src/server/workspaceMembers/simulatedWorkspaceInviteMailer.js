import { logSimulatedSideEffect } from "@jskit-ai/kernel/server/runtime/sideEffects";

/**
 * The invite mailer of a test copy (SIDE_EFFECTS is not `live`) in place of the provided
 * `workspaces.invite-mailer`: it emails nothing, logs the invitation's recipient, subject and link, and reports the
 * delivery as simulated, so the inviter copies the link to share it.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} logger
 * @returns {import("../types.js").WorkspaceInviteMailer}
 */
function createSimulatedWorkspaceInviteMailer(logger) {
  async function sendWorkspaceInvite({ email, inviteUrl, message }) {
    logSimulatedSideEffect(logger, {
      kind: "email",
      summary: `the workspace invitation email to ${email}`,
      details: { email, subject: String(message?.subject || ""), inviteUrl }
    });
    return {
      status: "simulated",
      message: "Test copy: the invitation email was not sent. Copy the invite link to share it.",
      messageCode: "workspaces.invite.simulated",
      messageParams: {},
      providerMessageId: ""
    };
  }

  return Object.freeze({ sendWorkspaceInvite });
}

export { createSimulatedWorkspaceInviteMailer };
