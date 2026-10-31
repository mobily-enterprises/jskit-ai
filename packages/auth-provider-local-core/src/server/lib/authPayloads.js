import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
import { ensureDevAuthRuntimeAvailable } from "@jskit-ai/auth-core/server/devAuth";

const PROVIDER_ID = "local";
const DEV_AUTH_SESSION_PURPOSE = "dev-auth";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} AuthProfileProjector */

function isNormalSession(session) {
  return (session?.purpose || "normal") === "normal";
}

function isDevAuthSession(session) {
  return session?.purpose === DEV_AUTH_SESSION_PURPOSE;
}

function isAuthenticatingSession(session) {
  return isNormalSession(session) || isDevAuthSession(session);
}

function buildProfile(user) {
  return {
    id: user.id,
    authProvider: PROVIDER_ID,
    authProviderUserSid: user.id,
    email: user.email,
    displayName: user.displayName,
    profileSource: "auth-provider"
  };
}

function buildActor(user, profile = null) {
  const profileSource = profile ? "users" : "auth-provider";
  return normalizeAuthActor({
    provider: PROVIDER_ID,
    providerUserId: user.id,
    email: user.email,
    displayName: user.displayName,
    appUserId: profile?.id || null,
    profileSource
  });
}

/** @param {{ user: object, session: object | null, appProfile: object | null }} result */
function buildAuthResult({ user, session, appProfile }) {
  return normalizeAuthResult({
    actor: buildActor(user, appProfile),
    session
  });
}

function requireProfileResult(profile, methodName) {
  if (!profile || typeof profile !== "object") {
    throw new Error(`auth.profile.projector.${methodName}() must return a profile object.`);
  }
  return profile;
}

/**
 * @param {object} input
 * @param {object} input.user
 * @param {object | null} input.session
 * @param {AuthProfileProjector | null} input.profileProjector
 * @param {object} [input.profileOptions]
 */
async function buildAuthPayload({ user, session, profileProjector, profileOptions = {} }) {
  const appProfile = profileProjector
    ? requireProfileResult(
        await profileProjector.syncIdentityProfile(buildProfile(user), profileOptions),
        "syncIdentityProfile"
      )
    : null;
  return buildAuthResult({ user, session, appProfile });
}

/**
 * @param {object} user
 * @param {AuthProfileProjector | null} profileProjector
 */
async function findExistingAppProfile(user, profileProjector) {
  if (!profileProjector) {
    return null;
  }
  // readable-check: allow method-probe - optional operation: findByIdentity is an optional profile projector operation
  if (typeof profileProjector.findByIdentity !== "function") {
    throw new Error(
      "auth.profile.projector.findByIdentity() is required for dev auth impersonation and profile lookups without sync."
    );
  }
  const profile = await profileProjector.findByIdentity(buildProfile(user));
  return profile ? requireProfileResult(profile, "findByIdentity") : null;
}

// A dev session, or a caller that asks only who is signed in (syncProfile:
// false), reads the existing app profile instead of synchronizing it.
/**
 * @param {object} input
 * @param {object} input.devAuth
 * @param {AuthProfileProjector | null} input.profileProjector
 * @param {object} input.request
 * @param {object} input.session
 * @param {object} input.user
 * @param {boolean} [input.syncProfile]
 */
async function buildSessionAuthPayload({ devAuth, profileProjector, request, session, user, syncProfile = true }) {
  const devSession = isDevAuthSession(session);
  if (!devSession && syncProfile) {
    return buildAuthPayload({ user, session: null, profileProjector });
  }
  if (devSession) {
    try {
      ensureDevAuthRuntimeAvailable(devAuth, request);
    } catch {
      return null;
    }
  }
  const appProfile = await findExistingAppProfile(user, profileProjector);
  return profileProjector && !appProfile
    ? null
    : buildAuthResult({ user, session: null, appProfile });
}

export {
  DEV_AUTH_SESSION_PURPOSE,
  PROVIDER_ID,
  buildAuthPayload,
  buildAuthResult,
  buildSessionAuthPayload,
  findExistingAppProfile,
  isAuthenticatingSession
};
