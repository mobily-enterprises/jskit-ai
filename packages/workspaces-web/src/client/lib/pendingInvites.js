import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * A pending invitation as the bootstrap payload lists it, or null when it lacks what the person needs to answer it.
 * @param {unknown} entry
 * @returns {import("../types.js").PendingInvite | null}
 */
function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = normalizeRecordId(entry.id, { fallback: null });
  const workspaceId = normalizeRecordId(entry.workspaceId, { fallback: null });
  if (!id || !workspaceId) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  const token = String(entry.token || "").trim();
  if (!workspaceSlug || !token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    workspaceAvatarUrl: String(entry.workspaceAvatarUrl || "").trim(),
    roleSid: String(entry.roleSid || "member").trim().toLowerCase() || "member",
    roleLabel: typeof entry.roleLabel === "string" ? entry.roleLabel.trim() : "",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

/**
 * The invitations a bootstrap payload offers: none when the application has them switched off.
 * @param {object} payload
 * @param {boolean} invitesEnabled
 * @returns {import("../types.js").PendingInvite[]}
 */
function readPendingInvites(payload, invitesEnabled) {
  if (!invitesEnabled) {
    return [];
  }
  const entries = Array.isArray(payload?.pendingInvites) ? payload.pendingInvites : [];
  return entries.map(normalizePendingInvite).filter(Boolean);
}

export { readPendingInvites };
