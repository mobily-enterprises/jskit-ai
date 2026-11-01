/**
 * The application's invitation email, provided as
 * `workspaces.invite-email-template`. workspaces-core passes every field; the
 * inviter is null when no one is signed in, and `roleLabel` is present only
 * when the role catalogue names the role.
 * @type {import("@jskit-ai/workspaces-core/server/types").WorkspaceInviteEmailTemplate}
 */
function renderWorkspaceInviteEmail({ inviteUrl, workspace, inviter, roleSid, roleLabel, expiresAt }) {
  const workspaceName = workspace.name || workspace.slug;
  const inviterName = inviter?.displayName || inviter?.email || "";
  const roleName = roleLabel || roleSid;
  const intro = inviterName
    ? `${inviterName} invited you to join ${workspaceName} as ${roleName}.`
    : `You have been invited to join ${workspaceName} as ${roleName}.`;
  const expiryText = expiresAt ? `This invitation expires at ${expiresAt}.` : "";

  return {
    subject: `You're invited to ${workspaceName}`,
    text: [intro, expiryText, "Open this link to accept the invitation:", inviteUrl].filter(Boolean).join("\n\n"),
    html: null
  };
}

export { renderWorkspaceInviteEmail };
