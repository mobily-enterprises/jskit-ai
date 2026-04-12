import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeIdentity } from "../repositories/usersRepository.js";

function buildNormalizedIdentityKey(identityLike) {
  const identity = normalizeIdentity(identityLike);
  if (!identity) {
    throw new TypeError("Profile identity is missing required fields.");
  }

  return {
    authProvider: identity.provider,
    authProviderUserSid: identity.providerUserId
  };
}

function buildNormalizedIdentityProfile(profileLike) {
  const source = profileLike && typeof profileLike === "object" ? profileLike : {};
  const identity = buildNormalizedIdentityKey(source);
  const email = normalizeLowerText(source.email);
  const displayName = normalizeText(source.displayName);

  if (!email || !displayName) {
    throw new TypeError("Profile identity is missing required fields.");
  }

  return {
    authProvider: identity.authProvider,
    authProviderUserSid: identity.authProviderUserSid,
    email,
    displayName,
    username: normalizeLowerText(source.username)
  };
}

function profileNeedsUpdate(existing, nextProfile) {
  if (!existing) {
    return true;
  }

  return (
    existing.email !== nextProfile.email ||
    existing.displayName !== nextProfile.displayName ||
    existing.authProvider !== nextProfile.authProvider ||
    existing.authProviderUserSid !== nextProfile.authProviderUserSid
  );
}

function requireSynchronizedProfile(profile) {
  if (profile && normalizeRecordId(profile.id, { fallback: null }) && String(profile.displayName || "").trim()) {
    return profile;
  }

  throw new Error("Profile synchronization failed.");
}

function createService({ usersRepository, workspaceProvisioningService = null, userSettingsRepository = null } = {}) {
  if (!usersRepository || typeof usersRepository.findByIdentity !== "function") {
    throw new Error("authProfileSyncService requires usersRepository.findByIdentity().");
  }
  if (typeof usersRepository.upsert !== "function") {
    throw new Error("authProfileSyncService requires usersRepository.upsert().");
  }
  if (!userSettingsRepository || typeof userSettingsRepository.ensureForUserId !== "function") {
    throw new Error("authProfileSyncService requires userSettingsRepository.ensureForUserId().");
  }

  async function findByIdentity(identityLike, options = {}) {
    const normalized = buildNormalizedIdentityKey(identityLike);
    return usersRepository.findByIdentity(
      {
        provider: normalized.authProvider,
        providerUserId: normalized.authProviderUserSid
      },
      options
    );
  }

  async function upsertByIdentity(profileLike, options = {}) {
    const normalized = buildNormalizedIdentityProfile(profileLike);
    return usersRepository.upsert(
      {
        authProvider: normalized.authProvider,
        authProviderUserSid: normalized.authProviderUserSid,
        email: normalized.email,
        displayName: normalized.displayName,
        username: normalized.username
      },
      options
    );
  }

  async function syncIdentityProfile(profileLike, options = {}) {
    const normalized = buildNormalizedIdentityProfile(profileLike);

    const runSync = async (trx = null) => {
      const operationOptions = trx ? { ...options, trx } : options;
      const existing = await findByIdentity(normalized, operationOptions);
      if (!profileNeedsUpdate(existing, normalized)) {
        const synchronizedProfile = requireSynchronizedProfile(existing);
        await userSettingsRepository.ensureForUserId(synchronizedProfile.id, operationOptions);
        return synchronizedProfile;
      }

      const upserted = await upsertByIdentity(normalized, operationOptions);
      const synchronizedProfile = requireSynchronizedProfile(upserted);
      await userSettingsRepository.ensureForUserId(synchronizedProfile.id, operationOptions);
      if (
        !existing &&
        workspaceProvisioningService &&
        typeof workspaceProvisioningService.provisionWorkspaceForNewUser === "function"
      ) {
        await workspaceProvisioningService.provisionWorkspaceForNewUser(synchronizedProfile, operationOptions);
      }

      return synchronizedProfile;
    };

    if (options?.trx) {
      return runSync(options.trx);
    }

    return usersRepository.withTransaction((trx) => runSync(trx));
  }

  return Object.freeze({
    findByIdentity,
    upsertByIdentity,
    syncIdentityProfile
  });
}

export { createService };
