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

function buildActor(user, profile) {
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

/**
 * @param {object} input
 * @param {object} input.user
 * @param {object | null} input.session
 * @param {AuthProfileProjector} input.profileProjector
 * @param {object} [input.profileOptions]
 */
async function buildAuthPayload({ user, session, profileProjector, profileOptions = {} }) {
  const appProfile = await profileProjector.syncIdentityProfile(buildProfile(user), profileOptions);
  return buildAuthResult({ user, session, appProfile });
}

/**
 * @param {object} user
 * @param {AuthProfileProjector} profileProjector
 */
function findExistingAppProfile(user, profileProjector) {
  return profileProjector.findByIdentity(buildProfile(user));
}

/**
 * A dev session, or a caller that asks only who is signed in (syncProfile:
 * false), reads the existing app profile instead of synchronizing it. When the
 * application keeps profiles, a user without one is not signed in.
 * @param {object} input
 * @param {boolean} input.appProfileProjection True when the application keeps profiles.
 * @param {object} input.devAuth
 * @param {AuthProfileProjector} input.profileProjector
 * @param {object} input.request
 * @param {object} input.session
 * @param {object} input.user
 * @param {boolean} [input.syncProfile]
 */
async function buildSessionAuthPayload({ appProfileProjection, devAuth, profileProjector, request, session, user, syncProfile = true }) {
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
  return appProfileProjection && !appProfile
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
