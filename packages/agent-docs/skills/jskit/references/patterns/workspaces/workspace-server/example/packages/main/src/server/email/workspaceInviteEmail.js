function renderWorkspaceInviteEmail({
  inviteUrl = "",
  workspace = {},
  inviter = null,
  roleSid = "member",
  expiresAt = ""
} = {}) {
  const workspaceName = String(workspace?.name || workspace?.slug || "the workspace").trim() || "the workspace";
  const inviterName = String(inviter?.displayName || inviter?.email || "").trim();
  const roleName = String(roleSid || "member").trim() || "member";
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
