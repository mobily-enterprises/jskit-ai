import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { BOOTSTRAP_PATH } from "@jskit-ai/kernel/shared/surface/paths";

function normalizeWorkspaceEntry(entry = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const id = normalizeRecordId(entry.id, { fallback: "" });
  const slug = normalizeLowerText(entry.slug);
  const name = normalizeText(entry.name);
  if (!id || !slug || !name) {
    return null;
  }

  return Object.freeze({
    id,
    slug,
    name,
    avatarUrl: normalizeText(entry.avatarUrl),
    roleSid: normalizeLowerText(entry.roleSid || "member") || "member",
    ...(typeof entry.roleLabel === "string" && entry.roleLabel.trim() ? { roleLabel: entry.roleLabel.trim() } : {}),
    isAccessible: entry.isAccessible !== false
  });
}

function normalizeWorkspaceList(entries = []) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => normalizeWorkspaceEntry(entry)).filter(Boolean);
}

function findWorkspaceBySlug(entries = [], workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return null;
  }

  return normalizeWorkspaceList(entries).find((entry) => entry.slug === normalizedWorkspaceSlug) || null;
}

function buildBootstrapApiPath(workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return BOOTSTRAP_PATH;
  }

  const params = new URLSearchParams({
    workspaceSlug: normalizedWorkspaceSlug
  });
  return `${BOOTSTRAP_PATH}?${params.toString()}`;
}

export { buildBootstrapApiPath, findWorkspaceBySlug, normalizeWorkspaceEntry, normalizeWorkspaceList };
