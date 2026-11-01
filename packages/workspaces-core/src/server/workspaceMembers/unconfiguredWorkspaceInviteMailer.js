/** The delivery outcome of an invitation when no feature provides a mailer. */
function buildMailerUnconfiguredDelivery() {
  return {
    status: "mailer_unconfigured",
    message: "No workspace invite mailer is configured.",
    messageCode: "workspaces.invite.mailerUnconfigured",
    messageParams: {},
    providerMessageId: ""
  };
}

/**
 * The `workspaces.invite-mailer` default when no feature provides one: invitations
 * are still created, and their delivery reports that no mailer is configured.
 * The members service recognizes it and answers that outcome without
 * rendering the email.
 * @type {import("../types.js").WorkspaceInviteMailer}
 */
const unconfiguredWorkspaceInviteMailer = Object.freeze({
  async sendWorkspaceInvite() {
    return buildMailerUnconfiguredDelivery();
  }
});

export { buildMailerUnconfiguredDelivery, unconfiguredWorkspaceInviteMailer };
