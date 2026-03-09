function normalizeQueryToken(value, { fallback = "__none__" } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

const USERS_WEB_QUERY_KEYS = Object.freeze({
  bootstrap(workspaceSlug = "") {
    return Object.freeze(["users-web", "bootstrap", normalizeQueryToken(workspaceSlug)]);
  },
  accountSettings() {
    return Object.freeze(["users-web", "settings", "account"]);
  },
  consoleSettings() {
    return Object.freeze(["users-web", "settings", "console"]);
  },
  workspaceSettings(surfaceId = "", workspaceSlug = "") {
    return Object.freeze([
      "users-web",
      "settings",
      "workspace",
      normalizeQueryToken(surfaceId),
      normalizeQueryToken(workspaceSlug)
    ]);
  },
  workspaceRoles(surfaceId = "", workspaceSlug = "") {
    return Object.freeze([
      "users-web",
      "workspace",
      "roles",
      normalizeQueryToken(surfaceId),
      normalizeQueryToken(workspaceSlug)
    ]);
  },
  workspaceMembers(surfaceId = "", workspaceSlug = "") {
    return Object.freeze([
      "users-web",
      "workspace",
      "members",
      normalizeQueryToken(surfaceId),
      normalizeQueryToken(workspaceSlug)
    ]);
  },
  workspaceInvites(surfaceId = "", workspaceSlug = "") {
    return Object.freeze([
      "users-web",
      "workspace",
      "invites",
      normalizeQueryToken(surfaceId),
      normalizeQueryToken(workspaceSlug)
    ]);
  }
});

export { USERS_WEB_QUERY_KEYS };
