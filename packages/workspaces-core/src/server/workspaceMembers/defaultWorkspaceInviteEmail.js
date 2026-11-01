function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * The `workspaces.invite-email-template` default. t renders a message in the
 * recipient's language. The markup stays here; each translated fragment,
 * parameters included, is escaped before it enters the HTML.
 * @type {import("../types.js").WorkspaceInviteEmailTemplate}
 */
function renderDefaultWorkspaceInviteEmail({ inviteUrl, workspace, inviter, roleSid, roleLabel, expiresAt, t }) {
  const workspaceName =
    String(workspace.name || workspace.slug || "").trim() || t("jskit.workspaces.inviteEmail.workspaceFallback");
  const inviterName = String(inviter?.displayName || inviter?.email || "").trim();
  const roleName = roleLabel || roleSid;
  const expiryText = t("jskit.workspaces.inviteEmail.expiry", { expiresAt });
  const intro = inviterName
    ? t("jskit.workspaces.inviteEmail.introFromInviter", { inviter: inviterName, workspace: workspaceName, role: roleName })
    : t("jskit.workspaces.inviteEmail.intro", { workspace: workspaceName, role: roleName });
  const subject = t("jskit.workspaces.inviteEmail.subject", { workspace: workspaceName });
  const text = [intro, expiryText, t("jskit.workspaces.inviteEmail.openLink"), inviteUrl].join("\n\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${escapeHtml(expiryText)}</p>`,
    `<p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(t("jskit.workspaces.inviteEmail.accept"))}</a></p>`,
    `<p>${escapeHtml(inviteUrl)}</p>`
  ].join("\n");

  return {
    subject,
    text,
    html
  };
}

export { renderDefaultWorkspaceInviteEmail };
