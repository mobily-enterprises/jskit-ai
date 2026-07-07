function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderDefaultWorkspaceInviteEmail({
  inviteUrl = "",
  workspace = {},
  inviter = null,
  roleSid = "member",
  expiresAt = ""
} = {}) {
  const workspaceName = String(workspace?.name || workspace?.slug || "the workspace").trim() || "the workspace";
  const inviterName = String(inviter?.displayName || inviter?.email || "").trim();
  const roleName = String(roleSid || "member").trim() || "member";
  const expiryText = expiresAt ? `This invitation expires at ${expiresAt}.` : "";
  const intro = inviterName
    ? `${inviterName} invited you to join ${workspaceName} as ${roleName}.`
    : `You have been invited to join ${workspaceName} as ${roleName}.`;
  const subject = `You're invited to ${workspaceName}`;
  const text = [intro, expiryText, `Open this link to accept the invitation:`, inviteUrl]
    .filter(Boolean)
    .join("\n\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    expiryText ? `<p>${escapeHtml(expiryText)}</p>` : "",
    `<p><a href="${escapeHtml(inviteUrl)}">Accept invitation</a></p>`,
    `<p>${escapeHtml(inviteUrl)}</p>`
  ].filter(Boolean).join("\n");

  return {
    subject,
    text,
    html
  };
}

export { renderDefaultWorkspaceInviteEmail };
