import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { hostOnlyCookieName, normalizeReturnToPath } from "@jskit-ai/auth-core/server/utils";
import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { NO_PASSWORD, hasPassword, normalizeDisplayName } from "./accounts.js";
import { buildAuthPayload } from "./authPayloads.js";
import { createOAuthClients } from "./oauth.js";
import { cookieOptions, safeRequestCookies } from "./sessions.js";
import { createId, isExpiredIso, isoFromNow, randomToken, sha256Base64url } from "./tokens.js";

const OAUTH_ATTEMPT_COOKIE_NAME = "jskit_local_oauth_attempt";
const OAUTH_ATTEMPT_TTL_SECONDS = 10 * 60;
// Every provider returns to the login page, which completes a sign-in or a link.
const OAUTH_REDIRECT_PATH = "/auth/login";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} AuthProfileProjector */

// Signing in with a configured OAuth provider, and linking or unlinking one.
/**
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {ReturnType<typeof import("../providers/AuthLocalProvider.js").resolveConfig>} dependencies.config
 * @param {boolean} dependencies.isProduction
 * @param {boolean} dependencies.oauthEnabled
 * @param {Map<string, ReturnType<typeof import("../providers/AuthLocalProvider.js").resolveConfig>["oauthProviders"][number]>} dependencies.oauthProvidersById
 * @param {AuthProfileProjector} dependencies.profileProjector
 * @param {ReturnType<typeof import("./securityStatus.js").createLocalSecurityStatus>} dependencies.securityStatus
 * @param {ReturnType<typeof import("./sessions.js").createLocalSessions>} dependencies.sessions
 */
function createLocalOAuthFlows({
  backend,
  config,
  isProduction,
  oauthEnabled,
  oauthProvidersById,
  profileProjector,
  securityStatus,
  sessions
}) {
  const OAUTH_ATTEMPT_COOKIE = hostOnlyCookieName(OAUTH_ATTEMPT_COOKIE_NAME, isProduction);
  const oauthRedirectUri = oauthEnabled ? `${config.appPublicUrl.replace(/\/$/u, "")}${OAUTH_REDIRECT_PATH}` : "";
  const appOrigin = oauthEnabled ? new URL(config.appPublicUrl).origin : "";
  const oauthClients = createOAuthClients({ logger: config.logger });

  function requireOAuthProvider(value) {
    const provider = oauthProvidersById.get(String(value || "").trim().toLowerCase());
    if (!provider) {
      throw new AppError(400, "This sign-in provider is not available.", { code: "auth.local.oauth.providerInvalid" });
    }
    return provider;
  }

  // The attempt (state, nonce, PKCE verifier) is stored server-side under the
  // hash of a random key that only the starting browser holds in a cookie.
  async function beginOAuthAttempt(provider, { intent, userId = "", returnTo }) {
    const browserKey = randomToken(32);
    const attempt = {
      browserKeyHash: sha256Base64url(browserKey),
      provider: provider.id,
      intent,
      userId,
      state: randomToken(32),
      nonce: randomToken(32),
      codeVerifier: randomToken(32),
      returnTo: normalizeReturnToPath(returnTo, { fallback: "/", allowedOrigins: [appOrigin] }),
      expiresAt: isoFromNow(OAUTH_ATTEMPT_TTL_SECONDS)
    };
    const url = await oauthClients.authorizationUrl(provider, { ...attempt, redirectUri: oauthRedirectUri });
    await backend.withTransaction(async (tx) => {
      await tx.oauthAttempts.deleteExpired(new Date().toISOString());
      await tx.oauthAttempts.create(attempt);
    });
    return { provider: provider.id, returnTo: attempt.returnTo, url, attempt: browserKey };
  }

  async function oauthStart(input = {}) {
    return beginOAuthAttempt(requireOAuthProvider(input.provider), { intent: "login", returnTo: input.returnTo });
  }

  async function startProviderLink(request, input = {}) {
    const userId = await sessions.requireNormalSessionUserId(request);
    return beginOAuthAttempt(requireOAuthProvider(input.provider), { intent: "link", userId, returnTo: input.returnTo });
  }

  function writeOAuthStartCookies(reply, result) {
    if (reply && result?.attempt) {
      reply.setCookie(OAUTH_ATTEMPT_COOKIE, result.attempt, cookieOptions(isProduction, OAUTH_ATTEMPT_TTL_SECONDS));
    }
  }

  function clearOAuthStartCookies(reply) {
    if (reply) {
      reply.clearCookie(OAUTH_ATTEMPT_COOKIE, cookieOptions(isProduction, 0));
    }
  }

  // Subject first, then a verified email that matches an existing user, then a
  // new user created like register; profile sync then provisions it as usual.
  async function signInWithOAuthIdentity(identity) {
    const result = await backend.withTransaction(async (tx) => {
      const linked = await tx.identities.findByProviderSubject(identity.provider, identity.providerSubject);
      let user = linked ? await tx.users.findById(linked.userId) : await tx.users.findByEmail(identity.email);
      const registered = !linked && !user;
      if (registered) {
        user = await tx.users.create({
          id: createId("usr"),
          email: identity.email,
          displayName: normalizeDisplayName(identity.name, identity.email),
          password: NO_PASSWORD
        });
      }
      if (!user || user.disabled) {
        throw new AppError(401, "This account can't sign in.", { code: "auth.local.oauth.accountUnavailable" });
      }
      if (!linked) {
        await tx.identities.create({
          userId: user.id,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        });
      }
      return { user, registered, session: await sessions.createSessionForUser(tx, user) };
    });
    return {
      ...(await buildAuthPayload({ user: result.user, session: result.session, profileProjector })),
      registered: result.registered
    };
  }

  async function linkOAuthIdentity(request, attempt, identity, provider) {
    const authResult = await sessions.authenticateRequest(request);
    if (authResult.authenticated !== true || authResult.actor.providerUserId !== attempt.userId) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }
    const user = await backend.withTransaction(async (tx) => {
      const linked = await tx.identities.findByProviderSubject(identity.provider, identity.providerSubject);
      if (linked && linked.userId !== attempt.userId) {
        throw new AppError(409, `This ${provider.label} account is already linked to another account.`, {
          code: "auth.local.oauth.identityTaken",
          params: { provider: provider.label }
        });
      }
      if (!linked) {
        await tx.identities.create({
          userId: attempt.userId,
          provider: identity.provider,
          providerSubject: identity.providerSubject,
          email: identity.email
        });
      }
      return tx.users.findById(attempt.userId);
    });
    return buildAuthPayload({ user, session: null, profileProjector });
  }

  async function oauthComplete(input = {}, request = null) {
    const errorCode = String(input.error || input.error_code || "").trim();
    if (errorCode) {
      throw errorCode === "access_denied"
        ? new AppError(401, "Sign-in was cancelled.", { code: "auth.local.oauth.cancelled" })
        : new AppError(401, "Sign-in was not completed. Start again.", { code: "auth.local.oauth.incomplete" });
    }
    const browserKey = String(safeRequestCookies(request)[OAUTH_ATTEMPT_COOKIE] || "").trim();
    // Taking an attempt deletes it, so each one completes at most once.
    const attempt = browserKey
      ? await backend.withTransaction((tx) => tx.oauthAttempts.take(sha256Base64url(browserKey)))
      : null;
    const state = String(input.state || "");
    // The provider is the one this attempt started with, whatever the callback names.
    const provider = attempt ? oauthProvidersById.get(attempt.provider) : null;
    if (!provider || isExpiredIso(attempt.expiresAt) || !state || state !== attempt.state) {
      throw new AppError(400, "This sign-in took too long or started in another browser. Start again.", {
        code: "auth.local.oauth.expired"
      });
    }
    const code = String(input.code || "").trim();
    if (!code) {
      throw new AppError(400, "OAuth code is required.", { code: "auth.local.oauth.codeRequired" });
    }
    const callbackUrl = new URL(oauthRedirectUri);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    if (input.iss) {
      callbackUrl.searchParams.set("iss", String(input.iss));
    }
    const identity = await oauthClients.verifiedIdentity(provider, { callbackUrl, attempt });
    const result = attempt.intent === "link"
      ? await linkOAuthIdentity(request, attempt, identity, provider)
      : await signInWithOAuthIdentity(identity);
    return { ...result, provider: provider.id, returnTo: attempt.returnTo };
  }

  async function unlinkProvider(request, input = {}) {
    const userId = await sessions.requireNormalSessionUserId(request);
    const provider = requireOAuthProvider(input.provider);
    await backend.withTransaction(async (tx) => {
      const user = await tx.users.findById(userId);
      const identities = await tx.identities.listForUser(userId);
      if (!identities.some((identity) => identity.provider === provider.id)) {
        throw new AppError(404, `${provider.label} is not linked to this account.`, {
          code: "auth.local.oauth.notLinked",
          params: { provider: provider.label }
        });
      }
      const otherMethodRemains = hasPassword(user) || identities.some(
        (identity) => identity.provider !== provider.id && oauthProvidersById.has(identity.provider)
      );
      if (!otherMethodRemains) {
        throw new AppError(409, "Add a password or link another sign-in method before removing this one.", {
          code: "auth.local.oauth.lastMethod"
        });
      }
      await tx.identities.deleteForUser(userId, provider.id);
    });
    return { securityStatus: await securityStatus.securityStatusForUser(userId) };
  }

  return Object.freeze({
    oauthStart,
    startProviderLink,
    writeOAuthStartCookies,
    clearOAuthStartCookies,
    oauthComplete,
    unlinkProvider
  });
}

export { createLocalOAuthFlows };
