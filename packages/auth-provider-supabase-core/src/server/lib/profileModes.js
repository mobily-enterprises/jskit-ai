import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { SUPABASE_PROVIDER_ID } from "./profileMirror.js";

/** In profile mode "provider", the profile is the Supabase user itself: its id, email and name. */
function createProviderProfileProjector() {
  async function findByIdentity() {
    return null;
  }

  async function syncIdentityProfile(profileLike) {
    const profile = normalizeObject(profileLike);
    const authProviderUserSid = String(profile.authProviderUserSid || "").trim();
    const email = normalizeEmail(profile.email || "");
    if (!authProviderUserSid || !email) {
      throw new TypeError("Provider identity profile requires authProviderUserSid and email.");
    }
    return {
      id: authProviderUserSid,
      authProvider: String(profile.authProvider || SUPABASE_PROVIDER_ID).trim() || SUPABASE_PROVIDER_ID,
      authProviderUserSid,
      email,
      displayName: String(profile.displayName || email.split("@")[0] || "User").trim(),
      profileSource: "auth-provider"
    };
  }

  return Object.freeze({
    findByIdentity,
    syncIdentityProfile
  });
}

/** Profile mode "provider" has no app users, so dev auth, which signs in as one, finds none. */
const PROVIDER_MODE_USER_PROFILES = Object.freeze({
  async findById() {
    return null;
  },
  async findByEmail() {
    return null;
  }
});

/** Profile mode "provider" keeps no password settings: every account may sign in with its password. */
const PROVIDER_MODE_USER_SETTINGS = Object.freeze({
  async ensureForUserId() {
    return { passwordSignInEnabled: true, passwordSetupRequired: false };
  },
  async updatePasswordSignInEnabled() {
    throw new Error("Password sign-in settings repository is not configured.");
  },
  async updatePasswordSetupRequired() {}
});

/**
 * config.auth.profileMode "provider" (the default): Supabase holds the
 * profile, and the app keeps no users of its own.
 * @type {import("../types.js").SupabaseProfiles}
 */
const PROVIDER_MODE_PROFILES = Object.freeze({
  projector: createProviderProfileProjector(),
  userProfilesRepository: PROVIDER_MODE_USER_PROFILES,
  userSettingsRepository: PROVIDER_MODE_USER_SETTINGS
});

/**
 * config.auth.profileMode "users": users-core keeps an app user for each
 * Supabase user, with its password sign-in settings.
 * @param {import("@jskit-ai/users-core/server/types").UsersIdentity} identity
 * @returns {import("../types.js").SupabaseProfiles}
 */
function createUsersModeProfiles(identity) {
  return Object.freeze({
    projector: identity.profileProjector,
    userProfilesRepository: identity.repositories.userProfiles,
    userSettingsRepository: identity.repositories.userSettings
  });
}

export { PROVIDER_MODE_PROFILES, createUsersModeProfiles };
