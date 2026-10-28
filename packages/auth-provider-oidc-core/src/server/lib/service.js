import { createHash, randomBytes } from "node:crypto";
import * as client from "openid-client";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
import {
  ensureDevAuthExchangeAvailable,
  ensureDevAuthRuntimeAvailable
} from "@jskit-ai/auth-core/server/devAuth";
import { hostOnlyCookieName, normalizeEmail, normalizeReturnToPath } from "@jskit-ai/auth-core/server/utils";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { AUTH_TEXTS, authFieldErrorDetails, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { AUTH_OIDC_PROVIDER_ID, AUTH_OIDC_REDIRECT_PATH } from "../../shared/index.js";
import { isLoopbackHostname } from "./config.js";
import {
  TRANSACTION_COOKIE,
  createTransactionSealer,
  transactionCookieOptions
} from "./transactionCookie.js";

const SESSION_COOKIE = "jskit_oidc_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEV_AUTH_SESSION_PURPOSE = "dev-auth";
const SIGN_IN_SCOPE = "openid email profile";

function sha256(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function cookiesOf(request) {
  return request?.cookies && typeof request.cookies === "object" ? request.cookies : {};
}

function firstHeader(value) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

function isLoopbackPeer(request) {
  const address = String(request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || "")
    .toLowerCase().replace(/^::ffff:/u, "");
  return address === "::1" || address.startsWith("127.");
}

function unauthenticated(clearSession = false) {
  return { authenticated: false, clearSession: Boolean(clearSession), session: null, transientFailure: false };
}

function displayNameFrom(claims, email) {
  const name = String(claims?.name || [claims?.given_name, claims?.family_name].filter(Boolean).join(" ") || "").trim();
  return (name || email.split("@")[0] || "User").slice(0, 160);
}

function buildProfile(identity) {
  return {
    authProvider: AUTH_OIDC_PROVIDER_ID,
    authProviderUserSid: identity.sub,
    email: identity.email,
    displayName: identity.displayName,
    profileSource: "auth-provider"
  };
}

function buildResult(identity, { session = null, appProfile = null } = {}) {
  return normalizeAuthResult({
    actor: normalizeAuthActor({
      provider: AUTH_OIDC_PROVIDER_ID,
      providerUserId: identity.sub,
      email: identity.email,
      displayName: identity.displayName,
      appUserId: appProfile?.id || null,
      profileSource: appProfile ? "users" : "auth-provider"
    }),
    session
  });
}

/**
 * The auth.service for an OpenID Connect issuer. The issuer verifies who the
 * person is; this app keeps its own session cookie and its own users row,
 * keyed (oidc, sub).
 */
function createOidcAuthService({ config, store, issuer, profileProjector = null, logger = null, now = Date.now }) {
  const sealer = createTransactionSealer({ secret: config.sessionSecret, now });
  const secureCookies = config.isProduction;
  // Production sessions use a host-only __Host- cookie, like the other providers.
  const sessionCookie = hostOnlyCookieName(SESSION_COOKIE, secureCookies);
  const projectorSyncs = typeof profileProjector?.syncIdentityProfile === "function";
  const devLoginEnabled = config.devAuth.enabled === true && config.devAuth.isProduction !== true;
  const capabilities = normalizeAuthCapabilities({
    provider: { id: AUTH_OIDC_PROVIDER_ID, label: config.label },
    features: {
      password: { login: false, register: false, change: false, methodToggle: false },
      passwordRecovery: { request: false, complete: false },
      otp: { login: false },
      oauthLogin: {
        enabled: true,
        providers: [{ id: AUTH_OIDC_PROVIDER_ID, label: config.label }],
        defaultProvider: AUTH_OIDC_PROVIDER_ID
      },
      emailConfirmation: false,
      profileUpdate: false,
      providerLinking: { start: false, unlink: false },
      securityStatus: false,
      signOutOtherSessions: false,
      appProfileProjection: projectorSyncs,
      devLoginAs: devLoginEnabled
    }
  });

  async function syncedResult(identity, { session = null } = {}) {
    if (!projectorSyncs) return buildResult(identity, { session });
    const appProfile = await profileProjector.syncIdentityProfile(buildProfile(identity));
    if (!appProfile || typeof appProfile !== "object") {
      throw new Error("auth.profile.projector.syncIdentityProfile() must return a profile object.");
    }
    return buildResult(identity, { session, appProfile });
  }

  async function existingProfile(identity) {
    if (!profileProjector) return null;
    if (typeof profileProjector.findByIdentity !== "function") {
      throw new Error("auth.profile.projector.findByIdentity() is required for preview identity.");
    }
    return profileProjector.findByIdentity(buildProfile(identity));
  }

  async function createSession(identity, { purpose = "normal", clientId = "", sid = "", idToken = "" } = {}) {
    const token = randomBytes(32).toString("base64url");
    await store.createSession({
      id: `oses_${randomBytes(18).toString("base64url")}`,
      tokenHash: sha256(token),
      issuer: config.issuer,
      clientId,
      sub: identity.sub,
      sid,
      email: identity.email,
      displayName: identity.displayName,
      idToken,
      purpose,
      expiresAt: new Date(now() + SESSION_TTL_SECONDS * 1000).toISOString()
    });
    return { token, purpose, expires_in: SESSION_TTL_SECONDS };
  }

  /**
   * The browser-facing origin this request arrived on: APP_PUBLIC_URL, else the
   * forwarded host set by a proxy on this machine, else the Host header.
   */
  function requestOrigin(request) {
    if (config.appPublicOrigin) return config.appPublicOrigin;
    const headers = request?.headers || {};
    const trustedProxy = isLoopbackPeer(request);
    const host = (trustedProxy && firstHeader(headers["x-forwarded-host"])) || firstHeader(headers.host);
    const https = (trustedProxy && firstHeader(headers["x-forwarded-proto"]) === "https") || request?.protocol === "https";
    let origin;
    try {
      origin = new URL(`${https ? "https" : "http"}://${host}`);
    } catch {
      throw new AppError(400, "This request has no usable address.", { code: "auth.oidc.request.noAddress" });
    }
    if (origin.protocol === "http:" && !isLoopbackHostname(origin.hostname) && config.isProduction) {
      throw new AppError(400, "Set APP_PUBLIC_URL so sign-in returns to this app's https address.", {
        code: "auth.oidc.request.publicUrlRequired"
      });
    }
    return origin.origin;
  }

  async function oauthStart(input = {}, request = null) {
    const provider = String(input.provider || AUTH_OIDC_PROVIDER_ID).trim().toLowerCase();
    if (provider !== AUTH_OIDC_PROVIDER_ID) {
      throw new AppError(400, `OAuth provider must be ${AUTH_OIDC_PROVIDER_ID}.`, {
        code: "auth.oidc.signIn.providerInvalid",
        params: { provider: AUTH_OIDC_PROVIDER_ID }
      });
    }
    const returnTo = normalizeReturnToPath(input.returnTo, { fallback: "/" });
    const origin = requestOrigin(request);
    const configuration = await issuer.configurationForOrigin(origin, { appName: config.appName });
    const state = client.randomState();
    const nonce = client.randomNonce();
    const verifier = client.randomPKCECodeVerifier();
    const url = client.buildAuthorizationUrl(configuration, {
      redirect_uri: `${origin}${AUTH_OIDC_REDIRECT_PATH}`,
      scope: SIGN_IN_SCOPE,
      state,
      nonce,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256"
    });
    return {
      provider,
      returnTo,
      url: url.href,
      attempt: sealer.seal({ state, nonce, verifier, origin, returnTo })
    };
  }

  function writeOAuthStartCookies(reply, result) {
    if (result?.attempt) reply.setCookie(TRANSACTION_COOKIE, result.attempt, transactionCookieOptions(secureCookies));
  }

  function clearOAuthStartCookies(reply) {
    reply.clearCookie(TRANSACTION_COOKIE, transactionCookieOptions(secureCookies, 0));
  }

  async function identityFromTokens(configuration, tokens) {
    const claims = tokens.claims() || {};
    let email = normalizeEmail(claims.email);
    let source = claims;
    if (!email && tokens.access_token) {
      source = await client.fetchUserInfo(configuration, tokens.access_token, claims.sub);
      email = normalizeEmail(source.email);
    }
    if (!email) {
      throw new AppError(401, "Your account provider did not share an email address.", { code: "auth.oidc.signIn.emailMissing" });
    }
    // Apps trust this address (invitations match it), so an issuer's explicit
    // "not confirmed" stops the sign-in. Issuers that never send the claim pass.
    if (source.email_verified === false) {
      throw new AppError(401, "Your account provider has not confirmed your email address yet. Confirm it there, then sign in again.", {
        code: "auth.oidc.signIn.emailUnconfirmed"
      });
    }
    return { sub: String(claims.sub), email, displayName: displayNameFrom(source, email), sid: String(claims.sid || "") };
  }

  async function oauthComplete(input = {}, request = null) {
    const errorCode = String(input.error || input.error_code || "").trim();
    if (errorCode) {
      throw errorCode === "access_denied"
        ? new AppError(401, "Sign-in was cancelled.", { code: "auth.oidc.signIn.cancelled" })
        : new AppError(401, "Sign-in was not completed. Start again.", { code: "auth.oidc.signIn.incomplete" });
    }
    const attempt = sealer.open(cookiesOf(request)[TRANSACTION_COOKIE]);
    const state = String(input.state || "");
    if (!attempt || !state || state !== attempt.state) {
      throw new AppError(400, "This sign-in took too long or started in another browser. Start again.", {
        code: "auth.oidc.signIn.expired"
      });
    }
    const code = String(input.code || "").trim();
    if (!code) throw new AppError(400, "OAuth code is required.", { code: "auth.oidc.signIn.codeRequired" });

    const configuration = await issuer.configurationForOrigin(attempt.origin, { appName: config.appName });
    const callback = new URL(`${attempt.origin}${AUTH_OIDC_REDIRECT_PATH}`);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    if (input.iss) callback.searchParams.set("iss", String(input.iss));
    let tokens;
    try {
      tokens = await client.authorizationCodeGrant(configuration, callback, {
        pkceCodeVerifier: attempt.verifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true
      });
    } catch (error) {
      logger?.warn?.({ err: { name: error?.name, code: error?.code, message: error?.message } }, "OIDC sign-in was rejected.");
      throw new AppError(401, "Your sign-in could not be verified. Start again.", { code: "auth.oidc.signIn.unverified" });
    }
    const identity = await identityFromTokens(configuration, tokens);
    const session = await createSession(identity, {
      clientId: configuration.clientMetadata().client_id,
      sid: identity.sid,
      idToken: tokens.id_token || ""
    });
    return { ...(await syncedResult(identity, { session })), provider: AUTH_OIDC_PROVIDER_ID, returnTo: attempt.returnTo };
  }

  async function sessionFromRequest(request) {
    const token = String(cookiesOf(request)[sessionCookie] || "").trim();
    return token ? store.findActiveSessionByTokenHash(sha256(token)) : null;
  }

  async function authenticateRequest(request) {
    const session = await sessionFromRequest(request);
    if (!session) return unauthenticated(hasSessionCookie(request));
    const identity = { sub: session.sub, email: session.email, displayName: session.displayName };
    let result;
    if (session.purpose === DEV_AUTH_SESSION_PURPOSE) {
      try {
        ensureDevAuthRuntimeAvailable(config.devAuth, request);
      } catch {
        return unauthenticated(true);
      }
      const appProfile = await existingProfile(identity);
      if (profileProjector && !appProfile) return unauthenticated(true);
      result = buildResult(identity, { appProfile });
    } else {
      result = await syncedResult(identity);
    }
    return {
      authenticated: true,
      ...result,
      session: null,
      sessionPurpose: session.purpose,
      clearSession: false,
      transientFailure: false
    };
  }

  async function devLoginAs(request, input = {}) {
    ensureDevAuthExchangeAvailable(config.devAuth, request);
    const userId = String(input?.userId || "").trim();
    const email = normalizeEmail(input?.email);
    if (!userId && !email) {
      throw createAuthError(AUTH_TEXTS.devUserRequired, {
        details: authFieldErrorDetails({ userId: AUTH_TEXTS.devUserRequired, email: AUTH_TEXTS.devUserRequired })
      });
    }
    const known = await store.findKnownUser(AUTH_OIDC_PROVIDER_ID, { userId, email });
    const identity = known ? { sub: known.sub, email: known.email, displayName: known.displayName } : null;
    const appProfile = identity ? await existingProfile(identity) : null;
    if (!identity || (profileProjector && !appProfile)) {
      throw createAuthError(AUTH_TEXTS.devUserNotFound, {
        details: authFieldErrorDetails({
          ...(userId ? { userId: AUTH_TEXTS.devUserNotFound } : {}),
          ...(email ? { email: AUTH_TEXTS.devUserNotFound } : {})
        })
      });
    }
    const session = await createSession(identity, { purpose: DEV_AUTH_SESSION_PURPOSE });
    return buildResult(identity, { session, appProfile });
  }

  function sessionCookieOptions(maxAge) {
    return { path: "/", httpOnly: true, sameSite: "lax", secure: secureCookies, maxAge };
  }

  function writeSessionCookies(reply, session) {
    if (!reply || !session?.token) return;
    reply.setCookie(sessionCookie, session.token, sessionCookieOptions(Number(session.expires_in || SESSION_TTL_SECONDS)));
  }

  function clearSessionCookies(reply) {
    if (!reply) return;
    reply.clearCookie(sessionCookie, sessionCookieOptions(0));
  }

  function hasSessionCookie(request) {
    return Boolean(cookiesOf(request)[sessionCookie]);
  }

  async function logout(request) {
    const session = await sessionFromRequest(request);
    if (session) await store.revokeSession(session.id);
    return { ok: true, clearSession: true, session };
  }

  /**
   * Ends this app's session and, with `everywhere`, returns the issuer's
   * end-session address so the person also signs out at the hub.
   */
  async function logoutEverywhere(request, { everywhere = false } = {}) {
    const { session } = await logout(request);
    if (!everywhere || !session?.idToken || !session.clientId) return "/";
    try {
      const configuration = await issuer.configurationForClientId(session.clientId);
      if (!configuration?.serverMetadata().end_session_endpoint) return "/";
      return client.buildEndSessionUrl(configuration, {
        id_token_hint: session.idToken,
        post_logout_redirect_uri: `${requestOrigin(request)}/`
      }).href;
    } catch (error) {
      logger?.warn?.({ err: error }, "OIDC end-session address is unavailable.");
      return "/";
    }
  }

  const unsupported = (operation) => () => throwUnsupportedAuthOperation(operation);

  return Object.freeze({
    getCapabilities: () => capabilities,
    isDevAuthBootstrapEnabled: () => devLoginEnabled,
    devLoginAs,
    authenticateRequest,
    // One cookie carries the session, so both questions read it.
    hasAccessTokenCookie: hasSessionCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies,
    writeOAuthStartCookies,
    clearOAuthStartCookies,
    oauthStart,
    oauthComplete,
    logout: async (request) => {
      await logout(request);
      return { ok: true, clearSession: true };
    },
    logoutEverywhere,
    register: unsupported("register"),
    resendRegisterConfirmation: unsupported("resendRegisterConfirmation"),
    login: unsupported("login"),
    requestOtpLogin: unsupported("requestOtpLogin"),
    verifyOtpLogin: unsupported("verifyOtpLogin"),
    requestPasswordReset: unsupported("requestPasswordReset"),
    completePasswordRecovery: unsupported("completePasswordRecovery"),
    resetPassword: unsupported("resetPassword"),
    changePassword: unsupported("changePassword"),
    updateDisplayName: unsupported("updateDisplayName"),
    getSecurityStatus: unsupported("getSecurityStatus"),
    setPasswordSignInEnabled: unsupported("setPasswordSignInEnabled"),
    startProviderLink: unsupported("startProviderLink"),
    unlinkProvider: unsupported("unlinkProvider"),
    signOutOtherSessions: unsupported("signOutOtherSessions")
  });
}

export { SESSION_COOKIE, createOidcAuthService };
