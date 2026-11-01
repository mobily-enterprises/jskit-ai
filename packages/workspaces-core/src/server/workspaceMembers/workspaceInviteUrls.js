const DEFAULT_INVITE_PATH = "/invite/:token";

// The configured invite path as an absolute path template.
function normalizeInvitePathTemplate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_INVITE_PATH;
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

// The invite path for a token: the template's :token or [token] replaced, else the token appended.
function buildInvitePath(token, template) {
  const encodedToken = encodeURIComponent(String(token || "").trim());
  if (template.includes(":token")) {
    return template.replaceAll(":token", encodedToken);
  }
  if (template.includes("[token]")) {
    return template.replaceAll("[token]", encodedToken);
  }
  return `${template.replace(/\/$/, "")}/${encodedToken}`;
}

// An http(s) base URL without its trailing slash, or "" for anything else.
function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * The invitation URL builder: `workspaceInvitations.invitePath` (default
 * /invite/:token) under `workspaceInvitations.inviteBaseUrl`, else the app's
 * `appPublicUrl`, else APP_PUBLIC_URL; a relative path when none is set.
 * @param {object} sources
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} sources.appConfig
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} sources.env
 */
function createWorkspaceInviteUrlBuilder({ appConfig, env }) {
  const inviteConfig = appConfig.workspaceInvitations && typeof appConfig.workspaceInvitations === "object"
    ? appConfig.workspaceInvitations
    : {};
  const baseUrl = normalizeBaseUrl(inviteConfig.inviteBaseUrl || appConfig.appPublicUrl || env.APP_PUBLIC_URL);
  const pathTemplate = normalizeInvitePathTemplate(inviteConfig.invitePath);

  /** @param {{ token: string, invite?: object, workspace?: object }} invite */
  return function buildWorkspaceInviteUrl({ token }) {
    const invitePath = buildInvitePath(token, pathTemplate);
    if (!baseUrl) {
      return invitePath;
    }
    return new URL(invitePath, `${baseUrl}/`).toString();
  };
}

export { createWorkspaceInviteUrlBuilder };
