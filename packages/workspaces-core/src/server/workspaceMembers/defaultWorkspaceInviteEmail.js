function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const EXPIRY_FORMAT = Object.freeze({
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short"
});

/**
 * The expiry date in the recipient's language and time zone. A locale or time zone
 * Intl does not know falls back to English or UTC; a value that is not a date is
 * shown as sent.
 * @param {string} expiresAt
 * @param {string} locale
 * @param {string} timeZone
 */
function formatInviteExpiry(expiresAt, locale, timeZone) {
  const date = new Date(expiresAt);
  if (!expiresAt || Number.isNaN(date.getTime())) {
    return String(expiresAt || "");
  }
  for (const [tryLocale, tryTimeZone] of [[locale, timeZone], [locale, "UTC"], ["en", "UTC"]]) {
    try {
      return new Intl.DateTimeFormat(tryLocale || "en", { ...EXPIRY_FORMAT, timeZone: tryTimeZone || "UTC" }).format(date);
    } catch {
      // An unknown locale or time zone: try the next fallback.
    }
  }
  return String(expiresAt);
}

/**
 * The `workspaces.invite-email-template` default. t renders a message in the
 * recipient's language. The markup stays here; each translated fragment,
 * parameters included, is escaped before it enters the HTML.
 * @type {import("../types.js").WorkspaceInviteEmailTemplate}
 */
function renderDefaultWorkspaceInviteEmail({
  inviteUrl,
  workspace,
  inviter,
  roleSid,
  roleLabel,
  expiresAt,
  locale = "en",
  timeZone = "UTC",
  t
}) {
  const workspaceName =
    String(workspace.name || workspace.slug || "").trim() || t("jskit.workspaces.inviteEmail.workspaceFallback");
  const inviterName = String(inviter?.displayName || inviter?.email || "").trim();
  const roleName = roleLabel || roleSid;
  const expiryText = t("jskit.workspaces.inviteEmail.expiry", { expiresAt: formatInviteExpiry(expiresAt, locale, timeZone) });
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

export { formatInviteExpiry, renderDefaultWorkspaceInviteEmail };
