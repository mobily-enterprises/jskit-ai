import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeIdentity } from "../repositories/userProfilesRepository.js";

function buildNormalizedIdentityKey(identityLike) {
  const identity = normalizeIdentity(identityLike);
  if (!identity) {
    throw new TypeError("Profile identity is missing required fields.");
  }

  return {
    authProvider: identity.provider,
    authProviderUserId: identity.providerUserId
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
    authProviderUserId: identity.authProviderUserId,
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
    existing.authProviderUserId !== nextProfile.authProviderUserId
  );
}

function requireSynchronizedProfile(profile) {
  if (profile && Number.isFinite(Number(profile.id)) && String(profile.displayName || "").trim()) {
    return profile;
  }

  throw new Error("Profile synchronization failed.");
}

function createService({ userProfilesRepository, workspaceProvisioningService = null, userSettingsRepository = null } = {}) {
  if (!userProfilesRepository || typeof userProfilesRepository.findByIdentity !== "function") {
    throw new Error("authProfileSyncService requires userProfilesRepository.findByIdentity().");
  }
  if (typeof userProfilesRepository.upsert !== "function") {
    throw new Error("authProfileSyncService requires userProfilesRepository.upsert().");
  }
  if (!userSettingsRepository || typeof userSettingsRepository.ensureForUserId !== "function") {
    throw new Error("authProfileSyncService requires userSettingsRepository.ensureForUserId().");
  }

  async function findByIdentity(identityLike, options = {}) {
    const normalized = buildNormalizedIdentityKey(identityLike);
    return userProfilesRepository.findByIdentity(
      {
        provider: normalized.authProvider,
        providerUserId: normalized.authProviderUserId
      },
      options
    );
  }

  async function upsertByIdentity(profileLike, options = {}) {
    const normalized = buildNormalizedIdentityProfile(profileLike);
    return userProfilesRepository.upsert(
      {
        authProvider: normalized.authProvider,
        authProviderUserId: normalized.authProviderUserId,
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
    if (typeof userProfilesRepository.withTransaction === "function") {
      return userProfilesRepository.withTransaction((trx) => runSync(trx));
    }
    return runSync();
  }

  return Object.freeze({
    findByIdentity,
    upsertByIdentity,
    syncIdentityProfile
  });
}

export { createService };
