function buildBootstrapApiPath(workspaceSlug = "") {
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!normalizedWorkspaceSlug) {
    return "/api/bootstrap";
  }

  const query = new URLSearchParams({
    workspaceSlug: normalizedWorkspaceSlug
  });
  return `/api/bootstrap?${query.toString()}`;
}

function normalizeWorkspaceEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const slug = String(entry.slug || "").trim();
  if (!Number.isInteger(id) || id < 1 || !slug) {
    return null;
  }

  return Object.freeze({
    id,
    slug,
    name: String(entry.name || slug).trim() || slug,
    color: String(entry.color || "").trim(),
    secondaryColor: String(entry.secondaryColor || "").trim(),
    surfaceColor: String(entry.surfaceColor || "").trim(),
    surfaceVariantColor: String(entry.surfaceVariantColor || "").trim(),
    avatarUrl: String(entry.avatarUrl || "").trim(),
    roleSid: String(entry.roleSid || "member").trim().toLowerCase() || "member",
    isAccessible: entry.isAccessible !== false
  });
}

function normalizeWorkspaceList(list) {
  const source = Array.isArray(list) ? list : [];
  return source.map(normalizeWorkspaceEntry).filter(Boolean);
}

function findWorkspaceBySlug(list, workspaceSlug) {
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!normalizedWorkspaceSlug) {
    return null;
  }

  const source = Array.isArray(list) ? list : [];
  for (const entry of source) {
    const normalizedEntry = normalizeWorkspaceEntry(entry);
    if (normalizedEntry && normalizedEntry.slug === normalizedWorkspaceSlug) {
      return normalizedEntry;
    }
  }

  return null;
}

function resolvePlacementUserFromBootstrapPayload(payload = {}, currentUser = null) {
  const source = payload && typeof payload === "object" ? payload : {};
  const session = source.session && typeof source.session === "object" ? source.session : {};
  if (session.authenticated !== true) {
    return null;
  }

  const profile = source.profile && typeof source.profile === "object" ? source.profile : {};
  const profileAvatar = profile.avatar && typeof profile.avatar === "object" ? profile.avatar : {};
  const fallbackUser = currentUser && typeof currentUser === "object" ? currentUser : {};
  const nextUser = {};

  const userId = Number(session.userId || fallbackUser.id || 0);
  if (Number.isInteger(userId) && userId > 0) {
    nextUser.id = userId;
  }

  const displayName = String(profile.displayName || fallbackUser.displayName || fallbackUser.name || "").trim();
  if (displayName) {
    nextUser.displayName = displayName;
    nextUser.name = displayName;
  }

  const email = String(profile.email || fallbackUser.email || "").trim().toLowerCase();
  if (email) {
    nextUser.email = email;
  }

  nextUser.avatarUrl = String(profileAvatar.effectiveUrl || fallbackUser.avatarUrl || "").trim();
  return Object.freeze(nextUser);
}

export {
  buildBootstrapApiPath,
  normalizeWorkspaceEntry,
  normalizeWorkspaceList,
  findWorkspaceBySlug,
  resolvePlacementUserFromBootstrapPayload
};
