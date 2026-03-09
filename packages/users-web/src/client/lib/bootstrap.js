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
    avatarUrl: String(entry.avatarUrl || "").trim(),
    roleId: String(entry.roleId || "member").trim().toLowerCase() || "member",
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

export {
  buildBootstrapApiPath,
  normalizeWorkspaceEntry,
  normalizeWorkspaceList,
  findWorkspaceBySlug
};
