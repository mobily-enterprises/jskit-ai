import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { hostOnlyCookieName } from "@jskit-ai/auth-core/server/utils";
import { isTransientSupabaseError, mapAuthError, mapRecoveryError } from "./authErrorMappers.js";
import { safeRequestCookies, cookieOptions, cookieClearOptions } from "./authCookies.js";
import { loadJose, classifyJwtVerifyError } from "./authJwt.js";
import { authenticateDevAuthRequest, isDevAuthToken } from "./devAuthBootstrap.js";
import { requireAuthenticatedProfile } from "./authenticatedProfile.js";

const ACCESS_TOKEN_COOKIE_NAME = "sb_access_token";
const REFRESH_TOKEN_COOKIE_NAME = "sb_refresh_token";
const RECOVERY_ACCESS_TOKEN_COOKIE_NAME = "sb_recovery_access_token";
const RECOVERY_REFRESH_TOKEN_COOKIE_NAME = "sb_recovery_refresh_token";
const PERSISTENT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

// A request's Supabase session: its cookies, verifying its access token,
// refreshing it, and signing it out.
/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./devAuthBootstrap.js").resolveDevAuthConfig>} dependencies.devAuthConfig
 * @param {() => void} dependencies.ensureConfigured Throws when Supabase is not configured.
 * @param {() => import("@supabase/supabase-js").SupabaseClient} dependencies.getSupabaseClient
 * @param {boolean} dependencies.isProduction
 * @param {string} dependencies.jwtAudience
 * @param {ReturnType<typeof import("./profileMirror.js").createProfileMirror>} dependencies.profileMirror
 * @param {string} dependencies.supabaseUrl
 * @param {import("@jskit-ai/users-core/server/types").UsersIdentity["repositories"]["userProfiles"] | null} dependencies.userProfilesRepository
 */
function createSupabaseSessions({
  devAuthConfig,
  ensureConfigured,
  getSupabaseClient,
  isProduction,
  jwtAudience,
  profileMirror,
  supabaseUrl,
  userProfilesRepository
}) {
  // Production cookies are Secure, so they are also host-only __Host- cookies.
  const ACCESS_TOKEN_COOKIE = hostOnlyCookieName(ACCESS_TOKEN_COOKIE_NAME, isProduction);
  const REFRESH_TOKEN_COOKIE = hostOnlyCookieName(REFRESH_TOKEN_COOKIE_NAME, isProduction);
  const RECOVERY_ACCESS_TOKEN_COOKIE = hostOnlyCookieName(RECOVERY_ACCESS_TOKEN_COOKIE_NAME, isProduction);
  const RECOVERY_REFRESH_TOKEN_COOKIE = hostOnlyCookieName(RECOVERY_REFRESH_TOKEN_COOKIE_NAME, isProduction);
  const issuerUrl = supabaseUrl ? new URL("/auth/v1", supabaseUrl).toString().replace(/\/$/, "") : "";
  const jwksUrl = issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : "";

  let jwksResolver = null;

  async function getJwksResolver() {
    if (jwksResolver) {
      return jwksResolver;
    }

    const jose = await loadJose();
    jwksResolver = jose.createRemoteJWKSet(new URL(jwksUrl));
    return jwksResolver;
  }

  async function verifyAccessToken(accessToken) {
    const jose = await loadJose();
    const jwks = await getJwksResolver();

    try {
      const { payload } = await jose.jwtVerify(accessToken, jwks, {
        issuer: issuerUrl,
        audience: jwtAudience,
        clockTolerance: 5
      });

      return {
        status: "valid",
        payload
      };
    } catch (error) {
      return {
        status: classifyJwtVerifyError(error)
      };
    }
  }

  async function verifyAccessTokenViaSupabase(accessToken, profileOptions = {}) {
    const supabase = getSupabaseClient();

    try {
      const response = await supabase.auth.getUser(accessToken);
      if (response.error) {
        if (isTransientSupabaseError(response.error)) {
          return { status: "transient" };
        }

        return { status: "invalid" };
      }

      if (!response.data?.user) {
        return { status: "invalid" };
      }

      const profile = await profileMirror.syncProfileFromSupabaseUser(response.data.user, response.data.user.email, profileOptions);
      return {
        status: "valid",
        profile
      };
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return { status: "transient" };
      }

      return { status: "invalid" };
    }
  }

  async function setSessionFromRequestCookies(request, options = {}) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();

    return setSupabaseSessionFromTokens({ accessToken, refreshToken }, options);
  }

  async function setRecoverySessionFromRequestCookies(request, options = {}) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[RECOVERY_ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[RECOVERY_REFRESH_TOKEN_COOKIE] || "").trim();

    return setSupabaseSessionFromTokens({ accessToken, refreshToken }, options);
  }

  async function setSupabaseSessionFromTokens({ accessToken, refreshToken }, options = {}) {
    const normalizedAccessToken = String(accessToken || "").trim();
    const normalizedRefreshToken = String(refreshToken || "").trim();

    if (!normalizedAccessToken || !normalizedRefreshToken) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }

    const supabase = options.supabaseClient || getSupabaseClient();
    let sessionResponse;
    try {
      sessionResponse = await supabase.auth.setSession({
        access_token: normalizedAccessToken,
        refresh_token: normalizedRefreshToken
      });
    } catch (error) {
      throw mapRecoveryError(error);
    }

    const session = sessionResponse.data?.session || null;
    const user = sessionResponse.data?.user || null;

    if (sessionResponse.error || !session || !user) {
      throw mapRecoveryError(sessionResponse.error);
    }

    return {
      ...sessionResponse,
      data: {
        ...sessionResponse.data,
        session,
        user
      }
    };
  }

  async function resolveCurrentSupabaseUser(request, options = {}) {
    const supabase = options.supabaseClient || getSupabaseClient();
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    let user = null;
    let session = null;

    async function getUserByAccessToken(token) {
      if (!token) {
        return null;
      }

      try {
        const userResponse = await supabase.auth.getUser(token);
        if (!userResponse.error && userResponse.data?.user) {
          return userResponse.data.user;
        }

        if (userResponse.error && isTransientSupabaseError(userResponse.error)) {
          throw mapAuthError(userResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }

      return null;
    }

    if (accessToken) {
      user = await getUserByAccessToken(accessToken);
    }

    if (!user) {
      const sessionResponse = await setSessionFromRequestCookies(request, {
        supabaseClient: supabase
      });
      user = sessionResponse.data.user || null;
      session = sessionResponse.data.session || null;
    }

    const currentAccessToken = String(session?.access_token || accessToken || "").trim();
    const explicitUser = await getUserByAccessToken(currentAccessToken);
    if (explicitUser) {
      user = explicitUser;
    }

    if (!user) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }

    return {
      session,
      user
    };
  }

  function resolveRequestSessionTokens(request) {
    const cookies = safeRequestCookies(request);
    return {
      accessToken: String(cookies[ACCESS_TOKEN_COOKIE] || ""),
      refreshToken: String(cookies[REFRESH_TOKEN_COOKIE] || "")
    };
  }

  async function authenticateDevAuthRequestFromCookies(request, tokens = resolveRequestSessionTokens(request)) {
    const devAuthResult = await authenticateDevAuthRequest(
      {
        request,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      },
      {
        config: devAuthConfig,
        userProfilesRepository
      }
    );

    if (!devAuthResult || devAuthResult.authenticated !== true) {
      return devAuthResult;
    }

    return profileMirror.withActor({
      ...devAuthResult,
      profile: requireAuthenticatedProfile(devAuthResult.profile, {
        context: "dev auth profile"
      })
    });
  }

  function writeSessionCookies(reply, session) {
    const accessToken = String(session?.access_token || "");
    const refreshToken = String(session?.refresh_token || "");
    if (!accessToken || !refreshToken) {
      return;
    }

    const sessionAccessMaxAge = Number.isFinite(Number(session?.expires_in)) ? Number(session.expires_in) : 3600;
    const purpose = String(session?.purpose || "normal").trim();
    const accessCookieName = purpose === "recovery" ? RECOVERY_ACCESS_TOKEN_COOKIE : ACCESS_TOKEN_COOKIE;
    const refreshCookieName = purpose === "recovery" ? RECOVERY_REFRESH_TOKEN_COOKIE : REFRESH_TOKEN_COOKIE;
    const cookieMaxAge = purpose === "recovery"
      ? Math.floor(sessionAccessMaxAge)
      : Math.max(Math.floor(sessionAccessMaxAge), PERSISTENT_SESSION_COOKIE_MAX_AGE_SECONDS);

    reply.setCookie(accessCookieName, accessToken, cookieOptions(isProduction, cookieMaxAge));
    reply.setCookie(refreshCookieName, refreshToken, cookieOptions(isProduction, cookieMaxAge));
  }

  function clearSessionCookies(reply) {
    for (const clearOptions of cookieClearOptions(isProduction)) {
      // A __Host- cookie only exists at Path=/.
      if (clearOptions.path === "/" || !isProduction) {
        reply.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
        reply.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
        reply.clearCookie(RECOVERY_ACCESS_TOKEN_COOKIE, clearOptions);
        reply.clearCookie(RECOVERY_REFRESH_TOKEN_COOKIE, clearOptions);
      }
    }
  }

  async function logout(request) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();

    if (!accessToken && !refreshToken) {
      return {
        ok: true,
        clearSession: true
      };
    }

    if (isDevAuthToken(accessToken) || isDevAuthToken(refreshToken)) {
      return {
        ok: true,
        clearSession: true
      };
    }

    ensureConfigured();
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    const response = await supabase.auth.signOut({
      scope: "local"
    });

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    return {
      ok: true,
      clearSession: true
    };
  }

  async function authenticateRequest(request, { syncProfile = true, refreshSession = true } = {}) {
    const { accessToken, refreshToken } = resolveRequestSessionTokens(request);
    // Without sync, a login whose app profile does not exist yet is not signed in.
    const signedIn = (profile, session = null) => (profile
      ? profileMirror.withActor({ authenticated: true, profile, clearSession: false, session, transientFailure: false })
      : { authenticated: false, clearSession: false, session: null, transientFailure: false });

    const devAuthResult = await authenticateDevAuthRequestFromCookies(request, { accessToken, refreshToken });
    if (devAuthResult) {
      return devAuthResult;
    }

    if (!accessToken && !refreshToken) {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    ensureConfigured();

    if (accessToken) {
      const verification = await verifyAccessToken(accessToken);

      if (verification.status === "valid") {
        return signedIn(await profileMirror.syncProfileFromJwtClaims(verification.payload, { syncProfile }));
      }

      if (verification.status === "transient") {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      if (verification.status === "invalid") {
        const supabaseVerification = await verifyAccessTokenViaSupabase(accessToken, { syncProfile });
        if (supabaseVerification.status === "valid") {
          return signedIn(supabaseVerification.profile);
        }

        if (supabaseVerification.status === "transient") {
          return {
            authenticated: false,
            clearSession: false,
            session: null,
            transientFailure: true
          };
        }
      }
    }

    if (!refreshToken) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    // A caller that cannot store a refreshed session, such as a realtime socket,
    // must not spend the single-use refresh token; it is told to refresh first.
    if (!refreshSession) {
      return {
        authenticated: false,
        refreshRequired: true,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    const supabase = getSupabaseClient();
    let refreshResponse;
    try {
      refreshResponse = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      /* c8 ignore next 17 -- defensive: refreshSession usually resolves with { error } for auth/transport issues. */
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (refreshResponse.error) {
      if (isTransientSupabaseError(refreshResponse.error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (!refreshResponse.data?.session || !refreshResponse.data?.user) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    const profile = await profileMirror.syncProfileFromSupabaseUser(refreshResponse.data.user, refreshResponse.data.user.email, { syncProfile });
    return signedIn(profile, refreshResponse.data.session);
  }

  function hasAccessTokenCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[RECOVERY_ACCESS_TOKEN_COOKIE]);
  }

  function hasSessionCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(
      cookies[ACCESS_TOKEN_COOKIE] ||
        cookies[REFRESH_TOKEN_COOKIE] ||
        cookies[RECOVERY_ACCESS_TOKEN_COOKIE] ||
        cookies[RECOVERY_REFRESH_TOKEN_COOKIE]
    );
  }

  return Object.freeze({
    // readable-check: allow setter-seam - sets the Supabase client's session from the request's cookies; it is not a slot
    setSessionFromRequestCookies,
    // readable-check: allow setter-seam - sets the Supabase client's recovery session from the request's cookies; it is not a slot
    setRecoverySessionFromRequestCookies,
    resolveCurrentSupabaseUser,
    authenticateDevAuthRequestFromCookies,
    authenticateRequest,
    hasAccessTokenCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies,
    logout
  });
}

export { createSupabaseSessions };
