import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeIdentity } from "../support/identity.js";

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

// The profile projector: keeps a users row in step with the identity that signs in.
/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("../repositories/userProfilesRepository.js").createRepository>} dependencies.userProfilesRepository
 * @param {ReturnType<typeof import("../repositories/userSettingsRepository.js").createRepository>} dependencies.userSettingsRepository
 * @param {import("../../types.js").UsersExtensions["profileSyncLifecycleContributors"]} dependencies.resolveLifecycleContributors
 *   Answers the registered contributors that run after each synchronization.
 */
function createService({ userProfilesRepository, resolveLifecycleContributors, userSettingsRepository }) {
  async function findByIdentity(identityLike, options = {}) {
    const normalized = buildNormalizedIdentityKey(identityLike);
    return userProfilesRepository.findByIdentity(
      {
        provider: normalized.authProvider,
        providerUserId: normalized.authProviderUserSid
      },
      options
    );
  }

  async function upsertByIdentity(profileLike, options = {}) {
    const normalized = buildNormalizedIdentityProfile(profileLike);
    return userProfilesRepository.upsert(
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
    const lifecycleContributors = resolveLifecycleContributors();

    const runSync = async (trx = null) => {
      const operationOptions = trx ? { ...options, trx } : options;
      const existing = await findByIdentity(normalized, operationOptions);
      let created = false;
      if (!profileNeedsUpdate(existing, normalized)) {
        const synchronizedProfile = requireSynchronizedProfile(existing);
        await userSettingsRepository.ensureForUserId(synchronizedProfile.id, operationOptions);
        for (const contributor of lifecycleContributors) {
          await contributor.afterIdentityProfileSynced({
            profile: synchronizedProfile,
            created,
            options: operationOptions
          });
        }
        return synchronizedProfile;
      }

      const upserted = await upsertByIdentity(normalized, operationOptions);
      const synchronizedProfile = requireSynchronizedProfile(upserted);
      await userSettingsRepository.ensureForUserId(synchronizedProfile.id, operationOptions);
      created = !existing;
      for (const contributor of lifecycleContributors) {
        await contributor.afterIdentityProfileSynced({
          profile: synchronizedProfile,
          created,
          options: operationOptions
        });
      }

      return synchronizedProfile;
    };

    if (options?.trx) {
      return runSync(options.trx);
    }

    return userProfilesRepository.withTransaction((trx) => runSync(trx));
  }

  return Object.freeze({
    findByIdentity,
    upsertByIdentity,
    syncIdentityProfile
  });
}

export { createService };
