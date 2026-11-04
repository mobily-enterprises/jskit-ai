import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { pageLocalStorage } from "../browser.js";
import { findWorkspaceBySlug } from "./bootstrap.js";

const LAST_WORKSPACE_STORAGE_KEY_PREFIX = "jskit.workspaces-web.last-workspace.";

function lastWorkspaceStorageKey(userId) {
  const normalizedUserId = normalizeRecordId(userId, { fallback: "" });
  return normalizedUserId ? `${LAST_WORKSPACE_STORAGE_KEY_PREFIX}${normalizedUserId}` : "";
}

function readLastWorkspaceSlug(userId, { storage = pageLocalStorage() } = {}) {
  const key = lastWorkspaceStorageKey(userId);
  if (!key || !storage) {
    return "";
  }

  try {
    return String(storage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function writeLastWorkspaceSlug(userId, workspaceSlug, { storage = pageLocalStorage() } = {}) {
  const key = lastWorkspaceStorageKey(userId);
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!key || !normalizedWorkspaceSlug || !storage) {
    return;
  }

  try {
    storage.setItem(key, normalizedWorkspaceSlug);
  } catch {
    // Ignore localStorage write failures in unsupported or locked-down environments.
  }
}

// Pending invitations keep the person on the workspaces page; otherwise open the
// last workspace used in this browser, or the only one they have.
function resolveWorkspaceLandingSlug({ workspaces = [], pendingInvites = [], lastWorkspaceSlug = "" } = {}) {
  if (pendingInvites.length > 0) {
    return "";
  }

  const lastWorkspace = findWorkspaceBySlug(workspaces, lastWorkspaceSlug);
  if (lastWorkspace?.isAccessible) {
    return lastWorkspace.slug;
  }

  return workspaces.length === 1 ? workspaces[0].slug : "";
}

export { readLastWorkspaceSlug, resolveWorkspaceLandingSlug, writeLastWorkspaceSlug };
