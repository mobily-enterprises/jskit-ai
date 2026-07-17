import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH
} from "@jskit-ai/auth-core/shared/authConstraints";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { buildSecurityStatusFromAuthMethodsStatus } from "@jskit-ai/auth-core/shared/authSecurityStatus";
import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
import {
  assertDevAuthPolicy,
  ensureDevAuthExchangeAvailable,
  ensureDevAuthRuntimeAvailable,
  resolveDevAuthPolicy
} from "@jskit-ai/auth-core/server/devAuth";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { normalizePasswordStrategy } from "./passwords.js";
import { randomToken, sha256Base64url, signToken, verifySignedToken } from "./tokens.js";

const ACCESS_TOKEN_COOKIE = "jskit_local_access_token";
const REFRESH_TOKEN_COOKIE = "jskit_local_refresh_token";
const RECOVERY_TOKEN_COOKIE = "jskit_local_recovery_token";
const PROVIDER_ID = "local";
const DEV_AUTH_SESSION_PURPOSE = "dev-auth";
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const RECOVERY_SESSION_TTL_SECONDS = 15 * 60;
const RECOVERY_TOKEN_TTL_SECONDS = 60 * 60;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function isoFromNow(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isExpiredIso(value) {
  return Date.parse(String(value || "")) <= Date.now();
}

function isNormalSession(session) {
  return (session?.purpose || "normal") === "normal";
}

function isDevAuthSession(session) {
  return session?.purpose === DEV_AUTH_SESSION_PURPOSE;
}

function isAuthenticatingSession(session) {
  return isNormalSession(session) || isDevAuthSession(session);
}

function normalizeDisplayName(value, email) {
  const displayName = String(value || "").trim();
  if (displayName) {
    return displayName;
  }
  return email.split("@")[0] || "User";
}

function createId(prefix) {
  return `${prefix}_${randomToken(18)}`;
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

function cookieOptions(isProduction, maxAge) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge
  };
}

function clearCookieOptions(isProduction) {
  return [
    { path: "/", httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 0 },
    { path: "/api", httpOnly: true, sameSite: "lax", secure: isProduction, maxAge: 0 }
  ];
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

function buildAuthResult({ user, session, appProfile = null }) {
  return normalizeAuthResult({
    profile: appProfile || buildProfile(user),
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

async function buildAuthPayload({ user, session, profileProjector, profileOptions = {} }) {
  const appProfile = profileProjector
    ? requireProfileResult(
        await profileProjector.syncIdentityProfile(buildProfile(user), profileOptions),
        "syncIdentityProfile"
      )
    : null;
  return buildAuthResult({ user, session, appProfile });
}

async function findExistingAppProfile(user, profileProjector) {
  if (!profileProjector) {
    return null;
  }
  if (typeof profileProjector.findByIdentity !== "function") {
    throw new Error(
      "auth.profile.projector.findByIdentity() is required for dev auth impersonation."
    );
  }
  const profile = await profileProjector.findByIdentity(buildProfile(user));
  return profile ? requireProfileResult(profile, "findByIdentity") : null;
}

async function buildSessionAuthPayload({ devAuth, profileProjector, request, session, user }) {
  if (!isDevAuthSession(session)) {
    return buildAuthPayload({ user, session: null, profileProjector });
  }
  try {
    ensureDevAuthRuntimeAvailable(devAuth, request);
  } catch {
    return null;
  }
  const appProfile = await findExistingAppProfile(user, profileProjector);
  return profileProjector && !appProfile
    ? null
    : buildAuthResult({ user, session: null, appProfile });
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

function validatePasswordInput(password) {
  const normalizedPassword = String(password || "");
  if (
    normalizedPassword.length < AUTH_PASSWORD_MIN_LENGTH ||
    normalizedPassword.length > AUTH_PASSWORD_MAX_LENGTH
  ) {
    throw new AppError(400, "Password must be at least 8 characters.", {
      details: {
        fieldErrors: {
          password: "Password must be at least 8 characters."
        }
      }
    });
  }
}

function validateEmailInput(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes("@")) {
    throw new AppError(400, "Enter a valid email address.", {
      details: {
        fieldErrors: {
          email: "Enter a valid email address."
        }
      }
    });
  }
  return normalized;
}

function devLoginAsValidationError(fieldErrors = {}) {
  const messages = Object.values(fieldErrors).filter(Boolean);
  return new AppError(400, messages[0] || "Provide a user id or email.", {
    details: {
      fieldErrors
    }
  });
}

function devLoginAsUserNotFound({ email = "", userId = "" } = {}) {
  return devLoginAsValidationError({
    ...(userId ? { userId: "User not found." } : {}),
    ...(email ? { email: "User not found." } : {})
  });
}

function normalizeInvitationInput(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const token = String(value.token || value.inviteToken || "").trim();
  if (!token) {
    return null;
  }
  return {
    token,
    source: String(value.source || "workspace-invite").trim() || "workspace-invite"
  };
}

async function maybeSendRecoveryEmail(config, recoveryUrl, email) {
  if (!config.smtpConfigured) {
    return;
  }
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? {
          user: config.smtp.user,
          pass: config.smtp.password
        }
      : undefined
  });
  await transport.sendMail({
    from: config.smtp.from,
    replyTo: config.smtp.replyTo || undefined,
    to: email,
    subject: "Reset your password",
    text: `Open this link to reset your password:\n\n${recoveryUrl}\n`
  });
}

function createLocalAuthService({
  backend,
  config,
  profileProjector = null,
  passwordStrategy = null,
  invitationContextResolver = null
}) {
  if (!backend || typeof backend.withTransaction !== "function") {
    throw new Error("Local auth requires auth.local.backend with withTransaction().");
  }
  if (!config?.sessionSecret) {
    throw new Error("Local auth requires a session secret.");
  }

  const passwords = normalizePasswordStrategy(passwordStrategy);
  const isProduction = config.nodeEnv === "production";
  const devAuth = config.devAuth || resolveDevAuthPolicy({
    nodeEnv: config.nodeEnv
  });
  assertDevAuthPolicy(devAuth);
  const profileProjectionEnabled = typeof profileProjector?.syncIdentityProfile === "function";
  const recoveryDelivery = config.smtpConfigured
    ? "smtp"
    : isProduction
      ? "disabled"
      : config.recoveryDevOutput === "response"
        ? "dev-response"
        : "dev-log";
  const recoveryEnabled = recoveryDelivery !== "disabled";
  const capabilities = normalizeAuthCapabilities({
    provider: {
      id: PROVIDER_ID,
      label: "Local"
    },
    features: {
      password: {
        login: true,
        register: true,
        change: true,
        methodToggle: false
      },
      passwordRecovery: {
        request: recoveryEnabled,
        complete: recoveryEnabled,
        delivery: recoveryDelivery
      },
      otp: {
        login: false
      },
      oauthLogin: {
        enabled: false,
        providers: []
      },
      emailConfirmation: false,
      profileUpdate: true,
      providerLinking: {
        start: false,
        unlink: false
      },
      securityStatus: true,
      signOutOtherSessions: true,
      appProfileProjection: profileProjectionEnabled,
      devLoginAs: devAuth.enabled === true && devAuth.isProduction !== true
    }
  });

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

  async function resolveProfileOptionsForRegistration(input = {}, { email } = {}) {
    const invitation = normalizeInvitationInput(input.invitation);
    if (!invitation) {
      return {};
    }

    let resolvedInvitation = invitation;
    if (invitationContextResolver && typeof invitationContextResolver.resolveInvitationContext === "function") {
      resolvedInvitation = await invitationContextResolver.resolveInvitationContext({
        ...invitation,
        email
      });
    }

    return {
      source: resolvedInvitation?.source || "workspace-invite",
      invitation: resolvedInvitation
    };
  }

  async function register(input = {}) {
    const email = validateEmailInput(input.email);
    validatePasswordInput(input.password);
    const displayName = normalizeDisplayName(input.displayName, email);
    const profileOptions = await resolveProfileOptionsForRegistration(input, { email });
    const password = await passwords.hashPassword(input.password);
    const result = await backend.withTransaction(async (tx) => {
      const existing = await tx.users.findByEmail(email);
      if (existing) {
        throw new AppError(409, "An account already exists for this email.");
      }
      const user = await tx.users.create({
        id: createId("usr"),
        email,
        displayName,
        password
      });
      return {
        user,
        session: await createSessionForUser(tx, user)
      };
    });
    return {
      ...(await buildAuthPayload({
        user: result.user,
        session: result.session,
        profileProjector,
        profileOptions
      })),
      requiresEmailConfirmation: false
    };
  }

  async function login(input = {}) {
    const email = validateEmailInput(input.email);
    const password = String(input.password || "");
    return backend.withTransaction(async (tx) => {
      const user = await tx.users.findByEmail(email);
      if (!user || user.disabled || !(await passwords.verifyPassword(password, user.password))) {
        throw new AppError(401, "Invalid email or password.");
      }
      const session = await createSessionForUser(tx, user);
      return buildAuthPayload({ user, session, profileProjector });
    });
  }

  function isDevAuthBootstrapEnabled() {
    return devAuth.enabled === true && devAuth.isProduction !== true;
  }

  async function devLoginAs(request, input = {}) {
    ensureDevAuthExchangeAvailable(devAuth, request);
    const userId = String(input?.userId || "").trim();
    const email = normalizeEmail(input?.email || "");
    if (!userId && !email) {
      throw devLoginAsValidationError({
        userId: "Provide a user id or email.",
        email: "Provide a user id or email."
      });
    }

    return backend.withTransaction(async (tx) => {
      let user = userId ? await tx.users.findById(userId) : null;
      if (!user && email) {
        user = await tx.users.findByEmail(email);
      }
      if (!user || user.disabled) {
        throw devLoginAsUserNotFound({ email, userId });
      }
      const appProfile = await findExistingAppProfile(user, profileProjector);
      if (profileProjector && !appProfile) {
        throw devLoginAsUserNotFound({ email, userId });
      }
      const session = await createSessionForUser(tx, user, {
        purpose: DEV_AUTH_SESSION_PURPOSE
      });
      return buildAuthResult({ user, session, appProfile });
    });
  }

  async function authenticateRequest(request) {
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
          const authPayload = await buildSessionAuthPayload({
            devAuth,
            profileProjector,
            request,
            session: resolved.session,
            user: resolved.user
          });
          if (!authPayload) {
            return unauthenticatedAuthResult(true);
          }
          return {
            authenticated: true,
            ...authPayload,
            session: null,
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
      devAuth,
      profileProjector,
      request,
      session: resolved.session,
      user: resolved.user
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
      sessionPurpose: resolved.session.purpose || "normal",
      clearSession: false,
      transientFailure: false
    };
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
        cookieOptions(isProduction, accessMaxAge)
      );
    }
    if (refreshToken) {
      reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(isProduction, refreshMaxAge));
    }
  }

  function clearSessionCookies(reply) {
    if (!reply) {
      return;
    }
    for (const options of clearCookieOptions(isProduction)) {
      reply.clearCookie(ACCESS_TOKEN_COOKIE, options);
      reply.clearCookie(REFRESH_TOKEN_COOKIE, options);
      reply.clearCookie(RECOVERY_TOKEN_COOKIE, options);
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
    return {
      ok: true,
      clearSession: true
    };
  }

  async function requestPasswordReset(input = {}) {
    if (!recoveryEnabled) {
      throw new AppError(503, "Password recovery is not configured.");
    }
    const email = validateEmailInput(input.email);
    let recoveryUrl = "";
    await backend.withTransaction(async (tx) => {
      const user = await tx.users.findByEmail(email);
      if (!user || user.disabled) {
        return;
      }
      const token = randomToken(32);
      recoveryUrl = `${config.appPublicUrl.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}&type=recovery`;
      await tx.recovery.create({
        id: createId("rec"),
        userId: user.id,
        tokenHash: sha256Base64url(token),
        expiresAt: isoFromNow(RECOVERY_TOKEN_TTL_SECONDS)
      });
    });
    if (recoveryUrl) {
      await maybeSendRecoveryEmail(config, recoveryUrl, email);
      if (!config.smtpConfigured && config.recoveryDevOutput === "log" && config.logger?.info) {
        config.logger.info({ recoveryUrl, email }, "Local auth password recovery URL created.");
      }
    }
    return {
      ok: true,
      message: "If an account exists for that email, password reset instructions have been sent.",
      ...(recoveryUrl && !config.smtpConfigured && config.recoveryDevOutput === "response" ? { recoveryUrl } : {})
    };
  }

  async function completePasswordRecovery(input = {}) {
    if (!recoveryEnabled) {
      throw new AppError(503, "Password recovery is not configured.");
    }
    const token = String(input.code || input.token || "").trim();
    const tokenHash = String(input.tokenHash || "").trim() || (token ? sha256Base64url(token) : "");
    if (!tokenHash) {
      throw new AppError(400, "Recovery token is required.");
    }
    return backend.withTransaction(async (tx) => {
      const recovery = await tx.recovery.findByTokenHash(tokenHash);
      if (!recovery || recovery.usedAt || isExpiredIso(recovery.expiresAt)) {
        throw new AppError(401, "Recovery token is invalid or expired.");
      }
      await tx.recovery.consume(recovery.id);
      const user = await tx.users.findById(recovery.userId);
      if (!user || user.disabled) {
        throw new AppError(401, "Recovery token is invalid or expired.");
      }
      const session = await createSessionForUser(tx, user, {
        purpose: "recovery",
        ttlSeconds: RECOVERY_SESSION_TTL_SECONDS
      });
      return buildAuthPayload({ user, session, profileProjector });
    });
  }

  async function resetPassword(request, input = {}) {
    validatePasswordInput(input.password);
    const cookies = safeRequestCookies(request);
    const recoveryAccessToken = String(cookies[RECOVERY_TOKEN_COOKIE] || "").trim();
    const payload = verifySignedToken(recoveryAccessToken, config.sessionSecret);
    if (!payload?.sub || !payload?.sid) {
      throw new AppError(401, "Authentication required.");
    }
    const password = await passwords.hashPassword(input.password);
    await backend.withTransaction(async (tx) => {
      const session = await tx.sessions.findById(String(payload.sid));
      if (!session || session.revokedAt || isExpiredIso(session.expiresAt)) {
        throw new AppError(401, "Authentication required.");
      }
      if (session.purpose !== "recovery") {
        throw new AppError(401, "Recovery session required.");
      }
      await tx.users.updatePassword(String(payload.sub), password);
      await tx.sessions.revokeForUser(String(payload.sub));
      if (typeof tx.recovery.consumeForUser === "function") {
        await tx.recovery.consumeForUser(String(payload.sub));
      }
    });
    return {
      ok: true,
      message: "Password updated. Sign in with your new password."
    };
  }

  async function changePassword(request, input = {}) {
    validatePasswordInput(input.newPassword);
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true || authResult.sessionPurpose !== "normal") {
      throw new AppError(401, "Authentication required.");
    }

    const currentPassword = String(input.currentPassword || "");
    const password = await passwords.hashPassword(input.newPassword);
    await backend.withTransaction(async (tx) => {
      const user = await tx.users.findById(authResult.actor.providerUserId);
      if (!user || user.disabled) {
        throw new AppError(401, "Authentication required.");
      }
      if (!(await passwords.verifyPassword(currentPassword, user.password))) {
        throw new AppError(401, "Current password is invalid.");
      }
      await tx.users.updatePassword(user.id, password);
    });

    return {
      ok: true,
      message: "Password updated."
    };
  }

  async function updateDisplayName(request, input = {}) {
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw new AppError(401, "Authentication required.");
    }
    const displayName = String(input.displayName || "").trim();
    if (!displayName) {
      throw new AppError(400, "Display name is required.");
    }
    return backend.withTransaction(async (tx) => {
      const user = await tx.users.updateProfile(authResult.actor.providerUserId, { displayName });
      if (!user) {
        throw new AppError(401, "Authentication required.");
      }
      return buildAuthPayload({ user, session: null, profileProjector });
    });
  }

  async function getSecurityStatus(request) {
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw new AppError(401, "Authentication required.");
    }
    return buildSecurityStatusFromAuthMethodsStatus(
      {
        methods: [
          {
            id: "password",
            kind: "password",
            provider: "email",
            label: "Password",
            configured: true,
            enabled: true,
            canDisable: false,
            supportsSecretUpdate: true,
            requiresCurrentPassword: false
          }
        ],
        minimumEnabledMethods: 1,
        enabledMethodsCount: 1
      },
      {
        actions: {
          changePassword: true,
          signOutOtherSessions: true
        }
      }
    );
  }

  async function signOutOtherSessions(request) {
    const authResult = await authenticateRequest(request);
    if (authResult.authenticated !== true) {
      throw new AppError(401, "Authentication required.");
    }
    const cookies = safeRequestCookies(request);
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();
    const currentSession = refreshToken ? await resolveValidSessionByRefreshToken(refreshToken) : null;
    const count = await backend.withTransaction((tx) =>
      tx.sessions.revokeForUser(authResult.actor.providerUserId, {
        exceptSessionId: currentSession?.session?.id
      })
    );
    return {
      ok: true,
      revokedSessions: count
    };
  }

  function getCapabilities() {
    return capabilities;
  }

  return Object.freeze({
    getCapabilities,
    isDevAuthBootstrapEnabled,
    devLoginAs,
    authenticateRequest,
    hasAccessTokenCookie(request) {
      return Boolean(safeRequestCookies(request)[ACCESS_TOKEN_COOKIE] || safeRequestCookies(request)[RECOVERY_TOKEN_COOKIE]);
    },
    hasSessionCookie(request) {
      const cookies = safeRequestCookies(request);
      return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE] || cookies[RECOVERY_TOKEN_COOKIE]);
    },
    writeSessionCookies,
    clearSessionCookies,
    register,
    resendRegisterConfirmation() {
      return throwUnsupportedAuthOperation("resendRegisterConfirmation");
    },
    login,
    requestOtpLogin() {
      return throwUnsupportedAuthOperation("requestOtpLogin");
    },
    verifyOtpLogin() {
      return throwUnsupportedAuthOperation("verifyOtpLogin");
    },
    oauthStart() {
      return throwUnsupportedAuthOperation("oauthStart");
    },
    oauthComplete() {
      return throwUnsupportedAuthOperation("oauthComplete");
    },
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    changePassword,
    updateDisplayName,
    getSecurityStatus,
    setPasswordSignInEnabled() {
      return throwUnsupportedAuthOperation("setPasswordSignInEnabled");
    },
    startProviderLink() {
      return throwUnsupportedAuthOperation("startProviderLink");
    },
    unlinkProvider() {
      return throwUnsupportedAuthOperation("unlinkProvider");
    },
    signOutOtherSessions,
    logout
  });
}

export { createLocalAuthService };
