// The `workspaces.invite-mailer` default when no feature provides one: invitations
// are still created, and their delivery reports that no mailer is configured.
/** @type {import("../types.js").WorkspaceInviteMailer} */
const unconfiguredWorkspaceInviteMailer = Object.freeze({
  async sendWorkspaceInvite() {
    return {
      status: "mailer_unconfigured",
      message: "No workspace invite mailer is configured.",
      messageCode: "workspaces.invite.mailerUnconfigured",
      messageParams: {},
      providerMessageId: ""
    };
  }
});

export { unconfiguredWorkspaceInviteMailer };
