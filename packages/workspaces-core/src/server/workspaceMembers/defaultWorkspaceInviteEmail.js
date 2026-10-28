import { createWorkspacesServerI18n } from "../i18n.js";

const englishI18n = createWorkspacesServerI18n();

function english(key, params) {
  return englishI18n.t("en", key, params);
}

function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// t renders a message in the recipient's language. The markup stays here; each
// translated fragment, parameters included, is escaped before it enters the HTML.
function renderDefaultWorkspaceInviteEmail({
  inviteUrl = "",
  workspace = {},
  inviter = null,
  roleSid = "member",
  roleLabel = "",
  expiresAt = "",
  t = english
} = {}) {
  const workspaceName =
    String(workspace?.name || workspace?.slug || "").trim() || t("jskit.workspaces.inviteEmail.workspaceFallback");
  const inviterName = String(inviter?.displayName || inviter?.email || "").trim();
  const roleName = (typeof roleLabel === "string" ? roleLabel.trim() : "") || String(roleSid || "member").trim() || "member";
  const expiryText = expiresAt ? t("jskit.workspaces.inviteEmail.expiry", { expiresAt }) : "";
  const intro = inviterName
    ? t("jskit.workspaces.inviteEmail.introFromInviter", { inviter: inviterName, workspace: workspaceName, role: roleName })
    : t("jskit.workspaces.inviteEmail.intro", { workspace: workspaceName, role: roleName });
  const subject = t("jskit.workspaces.inviteEmail.subject", { workspace: workspaceName });
  const text = [intro, expiryText, t("jskit.workspaces.inviteEmail.openLink"), inviteUrl]
    .filter(Boolean)
    .join("\n\n");
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    expiryText ? `<p>${escapeHtml(expiryText)}</p>` : "",
    `<p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(t("jskit.workspaces.inviteEmail.accept"))}</a></p>`,
    `<p>${escapeHtml(inviteUrl)}</p>`
  ].filter(Boolean).join("\n");

  return {
    subject,
    text,
    html
  };
}

export { renderDefaultWorkspaceInviteEmail };
