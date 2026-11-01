import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { resolveDisplayName } from "./authProfileNames.js";
import { requireAuthenticatedProfile } from "./authenticatedProfile.js";

/** The provider id of Supabase auth: in its capabilities, its profiles' identity and AUTH_PROVIDER. */
const SUPABASE_PROVIDER_ID = "supabase";
/** The code users-core's profiles repository gives an email that another sign-in already uses. */
const USER_PROFILE_EMAIL_CONFLICT_CODE = "USER_PROFILE_EMAIL_CONFLICT";
const AUTH_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

/** A profile's auth provider id, or SUPABASE_PROVIDER_ID when it names none or an invalid one. */
function normalizeAuthProviderId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return AUTH_PROVIDER_ID_PATTERN.test(normalized) ? normalized : SUPABASE_PROVIDER_ID;
}

function normalizeProviderUserId(value) {
  return String(value || "").trim();
}

/**
 * The app profile mirrored from a Supabase user or its token claims, and the
 * actor an auth result carries for it.
 * @param {object} dependencies
 * @param {import("../types.js").SupabaseConfig} dependencies.config
 * @param {import("../types.js").SupabaseProfiles} dependencies.profiles
 */
function createSupabaseProfileMirror({ config, profiles }) {
  const profileProjectionEnabled = config.profileMode === "users";
  const { projector } = profiles;

  function requireSynchronizedProfile(profile) {
    try {
      return requireAuthenticatedProfile(profile, {
        context: "authentication profile"
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(500, "Authentication profile synchronization failed. Please retry.", {
          code: "auth.supabase.profile.syncFailed"
        });
      }
      throw error;
    }
  }

  function buildNormalizedIdentityKey(identityLike) {
    const source = identityLike && typeof identityLike === "object" ? identityLike : {};
    const authProvider = normalizeAuthProviderId(source.authProvider);
    const authProviderUserSid = normalizeProviderUserId(source.authProviderUserSid);

    if (!authProviderUserSid) {
      throw new TypeError("Profile identity is missing required fields.");
    }

    return {
      authProvider,
      authProviderUserSid
    };
  }

  function buildNormalizedIdentityProfile(profileLike) {
    const source = profileLike && typeof profileLike === "object" ? profileLike : {};
    const identity = buildNormalizedIdentityKey(source);
    const email = normalizeEmail(source.email || "");
    const displayName = String(source.displayName || "").trim();

    if (!email || !displayName) {
      throw new TypeError("Profile identity is missing required fields.");
    }

    return {
      authProvider: identity.authProvider,
      authProviderUserSid: identity.authProviderUserSid,
      email,
      displayName
    };
  }

  async function findProfileByIdentity(identityProfile, options = {}) {
    const normalized = buildNormalizedIdentityKey(identityProfile);
    return projector.findByIdentity(
      {
        authProvider: normalized.authProvider,
        authProviderUserSid: normalized.authProviderUserSid
      },
      options
    );
  }

  /**
   * With syncProfile: false the caller asks only who is signed in, so the
   * existing profile is read instead of synchronized.
   */
  async function syncProfileMirror(nextProfile, { syncProfile = true } = {}) {
    if (!syncProfile) {
      return findProfileByIdentity(nextProfile);
    }
    try {
      const normalized = buildNormalizedIdentityProfile(nextProfile);
      const synchronizedProfile = await projector.syncIdentityProfile(normalized);
      return requireSynchronizedProfile(synchronizedProfile);
    } catch (error) {
      if (String(error?.code || "") === USER_PROFILE_EMAIL_CONFLICT_CODE) {
        throw new AppError(
          409,
          "This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security.",
          { code: "auth.supabase.profile.emailConflict" }
        );
      }

      throw error;
    }
  }

  async function syncProfileFromSupabaseUser(supabaseUser, fallbackEmail, profileOptions = {}) {
    const supabaseUserId = normalizeProviderUserId(supabaseUser?.id);
    const email = normalizeEmail(supabaseUser?.email || fallbackEmail);

    if (!supabaseUserId || !email) {
      throw new AppError(500, "Auth provider user payload is missing required fields.", { code: "auth.supabase.profile.payloadIncomplete" });
    }

    return syncProfileMirror({
      authProvider: SUPABASE_PROVIDER_ID,
      authProviderUserSid: supabaseUserId,
      email,
      displayName: resolveDisplayName(supabaseUser, email)
    }, profileOptions);
  }

  function buildActorFromProfile(profile) {
    return normalizeAuthActor(
      {
        provider: profile?.authProvider || SUPABASE_PROVIDER_ID,
        providerUserId: profile?.authProviderUserSid || profile?.id,
        email: profile?.email,
        displayName: profile?.displayName,
        appUserId: profileProjectionEnabled ? profile?.id : null,
        profileSource: profile?.profileSource || (profileProjectionEnabled ? "users" : "auth-provider")
      },
      {
        provider: SUPABASE_PROVIDER_ID,
        profileSource: profileProjectionEnabled ? "users" : "auth-provider"
      }
    );
  }

  function withActor(result) {
    if (!result || typeof result !== "object") {
      return result;
    }
    if (result.authenticated !== true && !result.profile) {
      return result;
    }
    const actor = buildActorFromProfile(result.profile);
    if (!actor) {
      return result;
    }
    const { profile: _profile, ...authResult } = result;
    return normalizeAuthResult({
      ...authResult,
      actor
    });
  }

  function withActorResult(operation) {
    return async (...args) => withActor(await operation(...args));
  }

  async function syncProfileFromJwtClaims(claims, { syncProfile = true } = {}) {
    const supabaseUserId = normalizeProviderUserId(claims?.sub);
    if (!supabaseUserId) {
      throw new AppError(401, "Token is missing subject claim.", { code: "auth.supabase.token.subjectMissing" });
    }

    const existing = await findProfileByIdentity({
      authProvider: SUPABASE_PROVIDER_ID,
      authProviderUserSid: supabaseUserId
    });
    if (!syncProfile) {
      return existing;
    }
    const emailFromToken = normalizeEmail(claims?.email || "");

    if (!emailFromToken) {
      if (existing) {
        return existing;
      }
      throw new AppError(401, "Token is missing email claim.", { code: "auth.supabase.token.emailMissing" });
    }

    return syncProfileMirror({
      authProvider: SUPABASE_PROVIDER_ID,
      authProviderUserSid: supabaseUserId,
      email: emailFromToken,
      displayName: resolveDisplayName(claims, emailFromToken)
    });
  }

  return Object.freeze({
    syncProfileFromSupabaseUser,
    syncProfileFromJwtClaims,
    withActor,
    withActorResult
  });
}

export { SUPABASE_PROVIDER_ID, createSupabaseProfileMirror };
