import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeWorkspaceSlug(value = "") {
  return normalizeLowerText(value);
}

function normalizeWorkspaceEntry(entry = null) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const id = normalizeRecordId(entry.id, { fallback: "" });
  const slug = normalizeWorkspaceSlug(entry.slug);
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
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return null;
  }

  return normalizeWorkspaceList(entries).find((entry) => entry.slug === normalizedWorkspaceSlug) || null;
}

function buildBootstrapApiPath(workspaceSlug = "") {
  const normalizedWorkspaceSlug = normalizeWorkspaceSlug(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return "/api/bootstrap";
  }

  const params = new URLSearchParams({
    workspaceSlug: normalizedWorkspaceSlug
  });
  return `/api/bootstrap?${params.toString()}`;
}

export { buildBootstrapApiPath, findWorkspaceBySlug, normalizeWorkspaceEntry, normalizeWorkspaceList };
