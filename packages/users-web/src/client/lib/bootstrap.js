import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";

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

  const userId = normalizeRecordId(session.userId || fallbackUser.id, { fallback: null });
  if (userId) {
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
  resolvePlacementUserFromBootstrapPayload
};
