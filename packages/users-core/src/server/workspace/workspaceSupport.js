function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLowerText(value);
}

function normalizeUserProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};
  const id = Number(source.id);
  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  return {
    id,
    email: normalizeEmail(source.email),
    displayName: normalizeText(source.displayName) || normalizeEmail(source.email) || `User ${id}`,
    authProvider: normalizeLowerText(source.authProvider),
    authProviderUserId: normalizeText(source.authProviderUserId),
    avatarStorageKey: source.avatarStorageKey ? normalizeText(source.avatarStorageKey) : null,
    avatarVersion: source.avatarVersion == null ? null : String(source.avatarVersion)
  };
}

export {
  normalizeEmail,
  normalizeLowerText,
  normalizeText,
  normalizeUserProfile
};
