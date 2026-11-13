import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { hostOnlyCookieName } from "@jskit-ai/auth-core/server/utils";
import { buildSessionAuthPayload, isAuthenticatingSession } from "./authPayloads.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url, signToken, verifySignedToken } from "./tokens.js";

const ACCESS_TOKEN_COOKIE_NAME = "jskit_local_access_token";
const REFRESH_TOKEN_COOKIE_NAME = "jskit_local_refresh_token";
const RECOVERY_TOKEN_COOKIE_NAME = "jskit_local_recovery_token";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function safeRequestCookies(request) {
  return request && request.cookies && typeof request.cookies === "object" ? request.cookies : {};
}

function unauthenticatedAuthResult(clearSession = false) {
  return {
    authenticated: false,
    clearSession: Boolean(clearSession),
    session: null,
    transientFailure: false
  };
}

/**
 * A local auth cookie: httpOnly at Path=/, Secure in production, with the application's SameSite
 * (AUTH_COOKIE_SAME_SITE).
 * @param {Pick<import("../types.js").AuthLocalConfig, "isProduction" | "cookieSameSite">} config
 * @param {number} maxAge
 */
function cookieOptions({ isProduction, cookieSameSite }, maxAge) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: cookieSameSite,
    secure: isProduction,
    maxAge
  };
}

/** @param {Pick<import("../types.js").AuthLocalConfig, "isProduction" | "cookieSameSite">} config */
function clearCookieOptions(config) {
  return [cookieOptions(config, 0), { ...cookieOptions(config, 0), path: "/api" }];
}

function buildAccessToken({ user, session, secret, ttlSeconds = ACCESS_TTL_SECONDS }) {
  const issuedAt = nowSeconds();
  return signToken(
    {
      iss: "jskit-auth-local",
      aud: "authenticated",
      sub: user.id,
      sid: session.id,
      purpose: session.purpose || "normal",
      email: user.email,
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      jti: randomToken(12)
    },
    secret
  );
}

/** @param {{ user: object, session: object, refreshToken: string, secret: string }} input */
function buildSessionPayload({ user, session, refreshToken, secret }) {
  const accessToken = buildAccessToken({ user, session, secret });
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TTL_SECONDS,
    token_type: "bearer",
    purpose: session.purpose || "normal"
  };
}

/**
 * The sessions of local auth: creating one, authenticating a request from its
 * cookies, writing and clearing those cookies, and revoking sessions. An
 * authenticated request's answer names its session (`sessionId`) and when the
 * session last proved its second factor (`secondFactorAt`, "" when it has not).
 * @param {object} dependencies
 * @param {boolean} dependencies.appProfileProjection True when the application keeps profiles.
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector
 */
function createLocalSessions({ appProfileProjection, backend, config, profileProjector }) {
  const { devAuth, isProduction } = config;
  // Production cookies are Secure, so they are also host-only __Host- cookies.
  const ACCESS_TOKEN_COOKIE = hostOnlyCookieName(ACCESS_TOKEN_COOKIE_NAME, isProduction);
  const REFRESH_TOKEN_COOKIE = hostOnlyCookieName(REFRESH_TOKEN_COOKIE_NAME, isProduction);
  const RECOVERY_TOKEN_COOKIE = hostOnlyCookieName(RECOVERY_TOKEN_COOKIE_NAME, isProduction);

  async function createSessionForUser(tx, user, { purpose = "normal", ttlSeconds = REFRESH_TTL_SECONDS } = {}) {
    const refreshToken = randomToken(36);
    const session = await tx.sessions.create({
      id: createId("ses"),
      userId: user.id,
      tokenHash: sha256Base64url(refreshToken),
      purpose,
      expiresAt: isoFromNow(ttlSeconds)
    });
    return buildSessionPayload({
      user,
      session,
      refreshToken,
      secret: config.sessionSecret
    });
  }

  async function resolveValidSessionByRefreshToken(refreshToken) {
    const tokenHash = sha256Base64url(refreshToken);
    return backend.withTransaction(async (tx) => {
      const session = await tx.sessions.findByTokenHash(tokenHash);
      if (!session || session.revokedAt || isExpiredIso(session.expiresAt)) {
        return null;
      }
      const user = await tx.users.findById(session.userId);
      if (!user || user.disabled) {
        return null;
      }
      return {
        user,
        session
      };
    });
  }

  // One authentication per request: the route's auth policy and the handlers it runs (security status, a display
  // name change, a password change, ...) share the first answer for the same request object instead of reading the
  // session, the user and the profile again. A request that revokes sessions forgets its answer, so a later check in
  // it reads them again, and every new request reads them afresh, so sign-out, revocation and disabling still apply
  // from the next request on.
  const requestAuthentications = new WeakMap();

  async function authenticateRequest(request, { syncProfile = true } = {}) {
    // A check without profile synchronization does not answer for a synchronizing one, and only an object can be
    // remembered.
    if (!syncProfile || !request || typeof request !== "object") {
      return authenticateFromCookies(request, { syncProfile });
    }
    if (!requestAuthentications.has(request)) {
      const answer = authenticateFromCookies(request, { syncProfile });
      requestAuthentications.set(request, answer);
      // A failure is not remembered: a later check in the request tries again.
      answer.catch(() => {
        if (requestAuthentications.get(request) === answer) {
          requestAuthentications.delete(request);
        }
      });
    }
    return requestAuthentications.get(request);
  }

  /** The request revoked sessions: a later authentication in it reads its session again. */
  function forgetRequestAuthentication(request) {
    requestAuthentications.delete(request);
  }

  /** The request changed its own user's profile: a later authentication in it answers the new `actor`. */
  function updateRequestActor(request, actor) {
    const answer = requestAuthentications.get(request);
    if (answer) {
      requestAuthentications.set(request, answer.then((result) => (result.authenticated ? { ...result, actor } : result)));
    }
  }

  async function authenticateFromCookies(request, { syncProfile }) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();

    if (accessToken) {
      const payload = verifySignedToken(accessToken, config.sessionSecret);
      if (payload?.sid && payload?.sub) {
        const resolved = await backend.withTransaction(async (tx) => {
          const session = await tx.sessions.findById(String(payload.sid));
          if (!session || session.revokedAt || isExpiredIso(session.expiresAt)) {
            return null;
          }
          const user = await tx.users.findById(String(payload.sub));
          if (!user || user.disabled) {
            return null;
          }
          return { user, session };
        });
        if (resolved && isAuthenticatingSession(resolved.session)) {
          // An ordinary request: its session and user are read above; the profile is synchronized only when it changed.
          const authPayload = await buildSessionAuthPayload({
            appProfileProjection,
            devAuth,
            profileProjector,
            request,
            session: resolved.session,
            user: resolved.user,
            syncProfile,
            onlyWhenChanged: true
          });
          if (!authPayload) {
            return unauthenticatedAuthResult(true);
          }
          return {
            authenticated: true,
            ...authPayload,
            session: null,
            sessionId: resolved.session.id,
            secondFactorAt: resolved.session.secondFactorAt || "",
            sessionPurpose: resolved.session.purpose || "normal",
            clearSession: false,
            transientFailure: false
          };
        }
      }
    }

    if (!refreshToken) {
      return unauthenticatedAuthResult(Boolean(accessToken));
    }

    const resolved = await resolveValidSessionByRefreshToken(refreshToken);
    if (!resolved) {
      return unauthenticatedAuthResult(true);
    }

    if (!isAuthenticatingSession(resolved.session)) {
      return unauthenticatedAuthResult();
    }

    const authPayload = await buildSessionAuthPayload({
      appProfileProjection,
      devAuth,
      profileProjector,
      request,
      session: resolved.session,
      user: resolved.user,
      syncProfile
    });
    if (!authPayload) {
      return unauthenticatedAuthResult(true);
    }

    return {
      authenticated: true,
      ...authPayload,
      session: buildSessionPayload({
        user: resolved.user,
        session: resolved.session,
        refreshToken,
        secret: config.sessionSecret
      }),
      sessionId: resolved.session.id,
      secondFactorAt: resolved.session.secondFactorAt || "",
      sessionPurpose: resolved.session.purpose || "normal",
      clearSession: false,
      transientFailure: false
    };
  }

  async function requireNormalSessionUserId(request) {
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true || authResult.sessionPurpose !== "normal") {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    return authResult.actor.providerUserId;
  }

  /** The access token of the request's recovery session, or "" when it has none. */
  function readRecoveryAccessToken(request) {
    return String(safeRequestCookies(request)[RECOVERY_TOKEN_COOKIE] || "").trim();
  }

  function hasAccessTokenCookie(request) {
    return Boolean(safeRequestCookies(request)[ACCESS_TOKEN_COOKIE] || safeRequestCookies(request)[RECOVERY_TOKEN_COOKIE]);
  }

  function hasSessionCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE] || cookies[RECOVERY_TOKEN_COOKIE]);
  }

  function writeSessionCookies(reply, session) {
    if (!reply || !session) {
      return;
    }
    const accessToken = String(session.access_token || "");
    const refreshToken = String(session.refresh_token || "");
    const purpose = String(session.purpose || "normal");
    const isRecoverySession = purpose === "recovery";
    const accessMaxAge = Number(session.expires_in || ACCESS_TTL_SECONDS);
    const refreshMaxAge = isRecoverySession ? accessMaxAge : REFRESH_TTL_SECONDS;
    if (accessToken) {
      reply.setCookie(
        isRecoverySession ? RECOVERY_TOKEN_COOKIE : ACCESS_TOKEN_COOKIE,
        accessToken,
        cookieOptions(config, accessMaxAge)
      );
    }
    if (refreshToken) {
      reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(config, refreshMaxAge));
    }
  }

  function clearSessionCookies(reply) {
    if (!reply) {
      return;
    }
    for (const options of clearCookieOptions(config)) {
      // A __Host- cookie only exists at Path=/.
      if (options.path === "/" || !isProduction) {
        reply.clearCookie(ACCESS_TOKEN_COOKIE, options);
        reply.clearCookie(REFRESH_TOKEN_COOKIE, options);
        reply.clearCookie(RECOVERY_TOKEN_COOKIE, options);
      }
    }
  }

  async function logout(request) {
    const cookies = safeRequestCookies(request);
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();
    if (!refreshToken) {
      return {
        ok: true,
        clearSession: true
      };
    }
    await backend.withTransaction(async (tx) => {
      const session = await tx.sessions.findByTokenHash(sha256Base64url(refreshToken));
      if (session) {
        await tx.sessions.revoke(session.id);
      }
    });
    forgetRequestAuthentication(request);
    return {
      ok: true,
      clearSession: true
    };
  }

  async function signOutOtherSessions(request) {
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    const cookies = safeRequestCookies(request);
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();
    const currentSession = refreshToken ? await resolveValidSessionByRefreshToken(refreshToken) : null;
    const count = await backend.withTransaction((tx) =>
      tx.sessions.revokeForUser(authResult.actor.providerUserId, {
        exceptSessionId: currentSession?.session?.id
      })
    );
    forgetRequestAuthentication(request);
    return {
      ok: true,
      revokedSessions: count
    };
  }

  return Object.freeze({
    createSessionForUser,
    authenticateRequest,
    forgetRequestAuthentication,
    updateRequestActor,
    requireNormalSessionUserId,
    readRecoveryAccessToken,
    hasAccessTokenCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies,
    logout,
    signOutOtherSessions
  });
}

export { cookieOptions, createLocalSessions, safeRequestCookies };
