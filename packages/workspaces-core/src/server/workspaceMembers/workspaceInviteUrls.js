function normalizeInvitePathTemplate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "/invite/:token";
  }
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function buildInvitePath(token, pathTemplate = "/invite/:token") {
  const encodedToken = encodeURIComponent(String(token || "").trim());
  const template = normalizeInvitePathTemplate(pathTemplate);
  if (template.includes(":token")) {
    return template.replaceAll(":token", encodedToken);
  }
  if (template.includes("[token]")) {
    return template.replaceAll("[token]", encodedToken);
  }
  return `${template.replace(/\/$/, "")}/${encodedToken}`;
}

function normalizeBaseUrl(value = "") {
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

function createWorkspaceInviteUrlBuilder({
  appConfig = {},
  env = {}
} = {}) {
  const inviteConfig = appConfig?.workspaceInvitations && typeof appConfig.workspaceInvitations === "object"
    ? appConfig.workspaceInvitations
    : {};
  const baseUrl = normalizeBaseUrl(
    inviteConfig.inviteBaseUrl ||
      inviteConfig.baseUrl ||
      appConfig?.appPublicUrl ||
      env.APP_PUBLIC_URL ||
      ""
  );
  const pathTemplate = normalizeInvitePathTemplate(inviteConfig.invitePath || inviteConfig.path || "/invite/:token");

  return function buildWorkspaceInviteUrl({ token } = {}) {
    const invitePath = buildInvitePath(token, pathTemplate);
    if (!baseUrl) {
      return invitePath;
    }
    return new URL(invitePath, `${baseUrl}/`).toString();
  };
}

export {
  buildInvitePath,
  createWorkspaceInviteUrlBuilder
};
