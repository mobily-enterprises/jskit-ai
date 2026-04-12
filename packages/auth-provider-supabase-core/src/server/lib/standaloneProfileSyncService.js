import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";

const USER_PROFILE_EMAIL_CONFLICT_CODE = "USER_PROFILE_EMAIL_CONFLICT";

function buildIdentityKey({ authProvider, authProviderUserSid } = {}) {
  return `${normalizeLowerText(authProvider)}:${normalizeText(authProviderUserSid)}`;
}

function normalizeIdentity(identityLike) {
  const source = identityLike && typeof identityLike === "object" ? identityLike : {};
  const authProvider = normalizeLowerText(source.authProvider || source.provider);
  const authProviderUserSid = normalizeText(source.authProviderUserSid || source.providerUserId);
  if (!authProvider || !authProviderUserSid) {
    throw new TypeError("Standalone profile sync requires authProvider and authProviderUserSid.");
  }
  return {
    authProvider,
    authProviderUserSid
  };
}

function normalizeProfile(profileLike) {
  const source = profileLike && typeof profileLike === "object" ? profileLike : {};
  const identity = normalizeIdentity(source);
  const email = normalizeLowerText(source.email);
  const displayName = normalizeText(source.displayName);
  if (!email || !displayName) {
    throw new TypeError("Standalone profile sync requires email and displayName.");
  }
  return {
    authProvider: identity.authProvider,
    authProviderUserSid: identity.authProviderUserSid,
    email,
    displayName
  };
}

function cloneProfile(profile) {
  return profile ? { ...profile } : null;
}

function createEmailConflictError() {
  const error = new Error("Email is already linked to a different profile.");
  error.code = USER_PROFILE_EMAIL_CONFLICT_CODE;
  return error;
}

function createStandaloneProfileSyncService() {
  const profilesByIdentityKey = new Map();
  const identityKeyByEmail = new Map();
  let nextId = 1n;

  async function findByIdentity(identityLike) {
    const identity = normalizeIdentity(identityLike);
    return cloneProfile(profilesByIdentityKey.get(buildIdentityKey(identity)) || null);
  }

  async function syncIdentityProfile(profileLike) {
    const normalizedProfile = normalizeProfile(profileLike);
    const identityKey = buildIdentityKey(normalizedProfile);
    const existing = profilesByIdentityKey.get(identityKey) || null;

    const existingOwnerIdentityKey = identityKeyByEmail.get(normalizedProfile.email);
    if (existingOwnerIdentityKey && existingOwnerIdentityKey !== identityKey) {
      throw createEmailConflictError();
    }

    const nextIdValue = existing?.id ? String(existing.id) : String(nextId);
    if (!existing?.id) {
      nextId += 1n;
    }

    const next = {
      id: nextIdValue,
      authProvider: normalizedProfile.authProvider,
      authProviderUserSid: normalizedProfile.authProviderUserSid,
      email: normalizedProfile.email,
      displayName: normalizedProfile.displayName
    };

    if (existing?.email && existing.email !== next.email) {
      identityKeyByEmail.delete(existing.email);
    }

    profilesByIdentityKey.set(identityKey, next);
    identityKeyByEmail.set(next.email, identityKey);
    return cloneProfile(next);
  }

  return Object.freeze({
    findByIdentity,
    syncIdentityProfile
  });
}

export { createStandaloneProfileSyncService };
export { USER_PROFILE_EMAIL_CONFLICT_CODE };
