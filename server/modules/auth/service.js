import { createClient } from "@supabase/supabase-js";
import { AppError } from "../../lib/errors.js";
import {
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  buildOAuthMethodId
} from "../../../shared/auth/authMethods.js";
import { AUTH_OAUTH_DEFAULT_PROVIDER } from "../../../shared/auth/oauthProviders.js";
import { normalizeEmail } from "../../../shared/auth/utils.js";
import { validators } from "../../../shared/auth/validators.js";
import {
  isTransientAuthMessage,
  isTransientSupabaseError,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError
} from "./lib/authErrorMappers.js";
import { displayNameFromEmail, resolveDisplayName, resolveDisplayNameFromClaims } from "./lib/authProfileNames.js";
import {
  normalizeOAuthProviderInput,
  validatePasswordRecoveryPayload,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError
} from "./lib/authInputParsers.js";
import {
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
} from "./lib/authRedirectUrls.js";
import {
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider
} from "./lib/authMethodStatus.js";
import { safeRequestCookies, cookieOptions } from "./lib/authCookies.js";
import { loadJose, isExpiredJwtError, classifyJwtVerifyError } from "./lib/authJwt.js";
import { buildDisabledPasswordSecret } from "./lib/authSecrets.js";
import { createAccountFlows } from "./lib/accountFlows.js";
import { createOauthFlows } from "./lib/oauthFlows.js";
import { createPasswordSecurityFlows } from "./lib/passwordSecurityFlows.js";

const ACCESS_TOKEN_COOKIE = "sb_access_token";
const REFRESH_TOKEN_COOKIE = "sb_refresh_token";
const DEFAULT_AUDIENCE = "authenticated";
function createService(options) {
  const supabaseUrl = String(options.supabaseUrl || "");
  const supabasePublishableKey = String(options.supabasePublishableKey || "");
  const userProfilesRepository = options.userProfilesRepository;
  const userSettingsRepository = options.userSettingsRepository || null;
  const isProduction = options.nodeEnv === "production";
  const jwtAudience = String(options.jwtAudience || DEFAULT_AUDIENCE);
  const passwordResetRedirectUrl = buildPasswordResetRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const otpLoginRedirectUrl = buildOtpLoginRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const appPublicUrl = String(options.appPublicUrl || "");

  const issuerUrl = supabaseUrl ? new URL("/auth/v1", supabaseUrl).toString().replace(/\/$/, "") : "";
  const jwksUrl = issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : "";

  let jwksResolver = null;

  function ensureConfigured() {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new AppError(500, "Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
    }
  }

  function createSupabaseClient() {
    ensureConfigured();
    return createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  function getSupabaseClient() {
    return createSupabaseClient();
  }

  function createStatelessSupabaseClient() {
    return createSupabaseClient();
  }

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

  async function verifyAccessTokenViaSupabase(accessToken) {
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

      const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);
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

    if (!accessToken || !refreshToken) {
      throw new AppError(401, "Authentication required.");
    }

    const supabase = options.supabaseClient || getSupabaseClient();
    let sessionResponse;
    try {
      sessionResponse = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
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
      throw new AppError(401, "Authentication required.");
    }

    return {
      session,
      user
    };
  }

  function writeSessionCookies(reply, session) {
    const accessToken = String(session?.access_token || "");
    const refreshToken = String(session?.refresh_token || "");
    if (!accessToken || !refreshToken) {
      return;
    }

    const accessMaxAge = Number.isFinite(Number(session?.expires_in)) ? Number(session.expires_in) : 3600;
    const refreshMaxAge = Math.max(accessMaxAge * 24, 86400);

    reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions(isProduction, accessMaxAge));
    reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(isProduction, refreshMaxAge));
  }

  function clearSessionCookies(reply) {
    const clearOptions = cookieOptions(isProduction, 0);
    reply.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
    reply.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
  }

  function profileNeedsUpdate(existing, nextProfile) {
    if (!existing) {
      return true;
    }

    return existing.email !== nextProfile.email || existing.displayName !== nextProfile.displayName;
  }

  function requireSynchronizedProfile(profile) {
    if (profile && Number.isFinite(Number(profile.id)) && String(profile.displayName || "").trim()) {
      return profile;
    }

    throw new AppError(500, "Authentication profile synchronization failed. Please retry.");
  }

  async function syncProfileMirror(nextProfile) {
    try {
      const existing = await userProfilesRepository.findBySupabaseUserId(nextProfile.supabaseUserId);
      if (!profileNeedsUpdate(existing, nextProfile)) {
        return requireSynchronizedProfile(existing);
      }

      const upserted = await userProfilesRepository.upsert(nextProfile);
      return requireSynchronizedProfile(upserted);
    } catch (error) {
      if (String(error?.code || "") === "USER_PROFILE_EMAIL_CONFLICT") {
        throw new AppError(
          409,
          "This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security."
        );
      }

      throw error;
    }
  }

  async function syncProfileFromSupabaseUser(supabaseUser, fallbackEmail) {
    const supabaseUserId = String(supabaseUser?.id || "").trim();
    const email = normalizeEmail(supabaseUser?.email || fallbackEmail);

    if (!supabaseUserId || !email) {
      throw new AppError(500, "Supabase user payload is missing required fields.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email,
      displayName: resolveDisplayName(supabaseUser, email)
    });
  }

  async function syncProfileFromJwtClaims(claims) {
    const supabaseUserId = String(claims?.sub || "").trim();
    if (!supabaseUserId) {
      throw new AppError(401, "Token is missing subject claim.");
    }

    const existing = await userProfilesRepository.findBySupabaseUserId(supabaseUserId);
    const emailFromToken = normalizeEmail(claims?.email || "");

    if (!emailFromToken) {
      if (existing) {
        return existing;
      }
      throw new AppError(401, "Token is missing email claim.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email: emailFromToken,
      displayName: resolveDisplayNameFromClaims(claims, emailFromToken)
    });
  }

  async function resolvePasswordSignInPolicyForUserId(userId) {
    if (!userSettingsRepository || typeof userSettingsRepository.ensureForUserId !== "function") {
      return {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      };
    }

    const settings = await userSettingsRepository.ensureForUserId(userId);
    return {
      passwordSignInEnabled: settings?.passwordSignInEnabled !== false,
      passwordSetupRequired: settings?.passwordSetupRequired === true
    };
  }

  async function setPasswordSignInEnabledForUserId(userId, enabled, options = {}) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSignInEnabled !== "function") {
      throw new AppError(500, "Password sign-in settings repository is not configured.");
    }

    const updated = await userSettingsRepository.updatePasswordSignInEnabled(userId, enabled, options);
    return {
      passwordSignInEnabled: updated.passwordSignInEnabled !== false,
      passwordSetupRequired: updated.passwordSetupRequired === true
    };
  }

  async function setPasswordSetupRequiredForUserId(userId, required) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSetupRequired !== "function") {
      return;
    }

    await userSettingsRepository.updatePasswordSetupRequired(userId, required);
  }

  async function resolveCurrentAuthContext(request, options = {}) {
    const current = await resolveCurrentSupabaseUser(request, options);
    const profile = await syncProfileFromSupabaseUser(current.user, current.user?.email || "");
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    const authMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, passwordSignInPolicy);

    return {
      ...current,
      profile,
      passwordSignInEnabled: passwordSignInPolicy.passwordSignInEnabled,
      passwordSetupRequired: passwordSignInPolicy.passwordSetupRequired,
      authMethodsStatus
    };
  }

  const { register, login, requestOtpLogin, verifyOtpLogin, updateDisplayName } = createAccountFlows({
    ensureConfigured,
    validators,
    validationError,
    getSupabaseClient,
    displayNameFromEmail,
    mapAuthError,
    syncProfileFromSupabaseUser,
    resolvePasswordSignInPolicyForUserId,
    otpLoginRedirectUrl,
    isTransientSupabaseError,
    isUserNotFoundLikeAuthError,
    parseOtpLoginVerifyPayload,
    mapOtpVerifyError,
    setSessionFromRequestCookies,
    mapProfileUpdateError
  });

  const { oauthStart, startProviderLink, oauthComplete, unlinkProvider } = createOauthFlows({
    ensureConfigured,
    normalizeOAuthProviderInput,
    normalizeReturnToPath,
    buildOAuthLoginRedirectUrl,
    appPublicUrl,
    authOAuthDefaultProvider: AUTH_OAUTH_DEFAULT_PROVIDER,
    getSupabaseClient,
    mapAuthError,
    setSessionFromRequestCookies,
    buildOAuthLinkRedirectUrl,
    parseOAuthCompletePayload,
    validationError,
    mapOAuthCallbackError,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    resolveCurrentAuthContext,
    buildOAuthMethodId,
    findAuthMethodById,
    findLinkedIdentityByProvider,
    buildSecurityStatusFromAuthMethodsStatus
  });

  const {
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    changePassword,
    setPasswordSignInEnabled,
    signOutOtherSessions,
    getSecurityStatus
  } = createPasswordSecurityFlows({
    ensureConfigured,
    validators,
    validationError,
    getSupabaseClient,
    passwordResetRedirectUrl,
    mapAuthError,
    validatePasswordRecoveryPayload,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    setSessionFromRequestCookies,
    resolvePasswordSignInPolicyForUserId,
    mapPasswordUpdateError,
    setPasswordSetupRequiredForUserId,
    normalizeEmail,
    createStatelessSupabaseClient,
    mapCurrentPasswordError,
    resolveCurrentAuthContext,
    findAuthMethodById,
    authMethodPasswordId: AUTH_METHOD_PASSWORD_ID,
    buildDisabledPasswordSecret,
    setPasswordSignInEnabledForUserId,
    buildAuthMethodsStatusFromSupabaseUser,
    buildSecurityStatusFromAuthMethodsStatus,
    authMethodPasswordProvider: AUTH_METHOD_PASSWORD_PROVIDER,
    buildAuthMethodsStatusFromProviderIds
  });

  async function authenticateRequest(request) {
    ensureConfigured();

    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "");
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "");

    if (!accessToken) {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    const verification = await verifyAccessToken(accessToken);

    if (verification.status === "valid") {
      const profile = await syncProfileFromJwtClaims(verification.payload);
      return {
        authenticated: true,
        profile,
        clearSession: false,
        session: null,
        transientFailure: false
      };
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
      const supabaseVerification = await verifyAccessTokenViaSupabase(accessToken);
      if (supabaseVerification.status === "valid") {
        return {
          authenticated: true,
          profile: supabaseVerification.profile,
          clearSession: false,
          session: null,
          transientFailure: false
        };
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

    if (!refreshToken) {
      return {
        authenticated: false,
        clearSession: true,
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

    const profile = await syncProfileFromSupabaseUser(refreshResponse.data.user, refreshResponse.data.user.email);

    return {
      authenticated: true,
      profile,
      clearSession: false,
      session: refreshResponse.data.session,
      transientFailure: false
    };
  }

  function hasAccessTokenCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE]);
  }

  function hasSessionCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE] || cookies[REFRESH_TOKEN_COOKIE]);
  }

  return {
    register,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    oauthStart,
    oauthComplete,
    startProviderLink,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    updateDisplayName,
    changePassword,
    setPasswordSignInEnabled,
    unlinkProvider,
    signOutOtherSessions,
    getSecurityStatus,
    authenticateRequest,
    hasAccessTokenCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies
  };
}

const __testables = {
  validatePasswordRecoveryPayload,
  displayNameFromEmail,
  resolveDisplayName,
  resolveDisplayNameFromClaims,
  isTransientAuthMessage,
  isTransientSupabaseError,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl,
  normalizeOAuthProviderInput,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError,
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  safeRequestCookies,
  cookieOptions,
  isExpiredJwtError,
  classifyJwtVerifyError
};

export { createService, __testables };
