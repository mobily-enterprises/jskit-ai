import { createClient } from "@supabase/supabase-js";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { ensureDevAuthExchangeAvailable } from "@jskit-ai/auth-core/server/devAuth";
import { normalizeAuthActor, normalizeAuthResult } from "@jskit-ai/auth-core/server/authActor";
import {
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  buildOAuthMethodId
} from "@jskit-ai/auth-core/shared/authMethods";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
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
} from "./authErrorMappers.js";
import { displayNameFromEmail, resolveDisplayName, resolveDisplayNameFromClaims } from "./authProfileNames.js";
import {
  normalizeOAuthProviderInput as normalizeOAuthProviderInputFromCatalog,
  mapOAuthCallbackError
} from "./authInputParsers.js";
import {
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
} from "./authRedirectUrls.js";
import {
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider
} from "./authMethodStatus.js";
import { safeRequestCookies, cookieOptions, cookieClearOptions } from "./authCookies.js";
import { loadJose, isExpiredJwtError, classifyJwtVerifyError } from "./authJwt.js";
import { buildDisabledPasswordSecret } from "./authSecrets.js";
import { createAccountFlows } from "./accountFlows.js";
import { createOauthFlows } from "./oauthFlows.js";
import { createPasswordSecurityFlows } from "./passwordSecurityFlows.js";
import { buildSupabaseServerClientOptions } from "./supabaseClientOptions.js";
import { USER_PROFILE_EMAIL_CONFLICT_CODE } from "./standaloneProfileSyncService.js";
import {
  assertDevAuthBootstrapConfig,
  authenticateDevAuthRequest,
  createDevAuthSession,
  isDevAuthToken,
  resolveDevAuthConfig,
  resolveDevAuthProfile
} from "./devAuthBootstrap.js";
import { requireAuthenticatedProfile } from "./authenticatedProfile.js";
import {
  buildOAuthProviderCatalogResponse,
  resolveOAuthProviderQueryParams,
  resolveSupabaseOAuthProviderCatalog
} from "./oauthProviderCatalog.js";

const ACCESS_TOKEN_COOKIE = "sb_access_token";
const REFRESH_TOKEN_COOKIE = "sb_refresh_token";
const RECOVERY_ACCESS_TOKEN_COOKIE = "sb_recovery_access_token";
const RECOVERY_REFRESH_TOKEN_COOKIE = "sb_recovery_refresh_token";
const DEFAULT_AUDIENCE = "authenticated";
const DEFAULT_AUTH_PROVIDER_ID = "supabase";
const AUTH_PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;
const PERSISTENT_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

function normalizeAuthProviderId(value, { fallback = DEFAULT_AUTH_PROVIDER_ID } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (AUTH_PROVIDER_ID_PATTERN.test(normalized)) {
    return normalized;
  }

  const fallbackNormalized = String(fallback || "")
    .trim()
    .toLowerCase();
  if (AUTH_PROVIDER_ID_PATTERN.test(fallbackNormalized)) {
    return fallbackNormalized;
  }

  return DEFAULT_AUTH_PROVIDER_ID;
}

function normalizeProviderUserId(value) {
  return String(value || "").trim();
}

function createService(options) {
  const authProvider = options.authProvider && typeof options.authProvider === "object" ? options.authProvider : null;
  if (!authProvider) {
    throw new Error("authProvider is required.");
  }

  const authProviderId = normalizeAuthProviderId(authProvider.id);
  if (authProviderId !== DEFAULT_AUTH_PROVIDER_ID) {
    throw new Error(`Unsupported auth provider "${authProviderId}".`);
  }

  const supabaseUrl = String(authProvider.supabaseUrl || "").trim();
  const supabasePublishableKey = String(authProvider.supabasePublishableKey || "").trim();
  const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);
  const userSettingsRepository = options.userSettingsRepository || null;
  const passwordMethodToggleSupported =
    typeof userSettingsRepository?.ensureForUserId === "function" &&
    typeof userSettingsRepository?.updatePasswordSignInEnabled === "function";
  const userProfilesRepository = options.userProfilesRepository || null;
  const userProfileSyncService = options.userProfileSyncService;
  const profileProjectionEnabled = options.profileProjectionEnabled === true;
  if (
    !userProfileSyncService ||
    typeof userProfileSyncService.syncIdentityProfile !== "function" ||
    typeof userProfileSyncService.findByIdentity !== "function"
  ) {
    throw new Error("userProfileSyncService with syncIdentityProfile() and findByIdentity() is required.");
  }
  const isProduction = options.nodeEnv === "production";
  const jwtAudience = String(authProvider.jwtAudience || DEFAULT_AUDIENCE).trim();
  const devAuthConfig = resolveDevAuthConfig({
    enabled: options.devAuthBypassEnabled,
    secret: options.devAuthBypassSecret,
    nodeEnv: options.nodeEnv,
    jwtAudience,
    accessTtlSeconds: options.devAuthAccessTtlSeconds,
    refreshTtlSeconds: options.devAuthRefreshTtlSeconds
  });
  assertDevAuthBootstrapConfig(devAuthConfig, {
    userProfilesRepository
  });
  const settingsProfileAuthInfo = Object.freeze({
    emailManagedBy: normalizeAuthProviderId(authProvider.emailManagedBy || authProviderId, { fallback: authProviderId }),
    emailChangeFlow: normalizeAuthProviderId(authProvider.emailChangeFlow || authProviderId, { fallback: authProviderId })
  });
  const passwordResetRedirectUrl = buildPasswordResetRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const otpLoginRedirectUrl = buildOtpLoginRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const appPublicUrl = String(options.appPublicUrl || "");
  const authAllowedReturnToOrigins = Array.isArray(options.authAllowedReturnToOrigins)
    ? options.authAllowedReturnToOrigins
    : [];
  const authOAuthCatalog = resolveSupabaseOAuthProviderCatalog({
    oauthProviderCatalog: authProvider.oauthProviderCatalog || options.authOAuthProviderCatalog,
    oauthProviders: authProvider.oauthProviders ?? options.authOAuthProviders,
    oauthDefaultProvider: authProvider.oauthDefaultProvider ?? options.authOAuthDefaultProvider,
    oauthProviderLabels: authProvider.oauthProviderLabels || options.authOAuthProviderLabels,
    oauthProviderQueryParams: authProvider.oauthProviderQueryParams || options.authOAuthProviderQueryParams
  });
  const authOAuthProviders = authOAuthCatalog.providers;
  const authOAuthProviderIds = authOAuthCatalog.providerIds;
  const authOAuthDefaultProvider = authOAuthCatalog.defaultProvider;
  const authOAuthCatalogResponse = Object.freeze(buildOAuthProviderCatalogResponse(authOAuthCatalog));
  const capabilities = normalizeAuthCapabilities({
    provider: {
      id: authProviderId,
      label: "Supabase"
    },
    features: {
      password: {
        login: supabaseConfigured,
        register: supabaseConfigured,
        change: supabaseConfigured,
        methodToggle: supabaseConfigured && passwordMethodToggleSupported
      },
      passwordRecovery: {
        request: supabaseConfigured,
        complete: supabaseConfigured,
        delivery: supabaseConfigured ? "smtp" : "disabled"
      },
      otp: {
        login: supabaseConfigured
      },
      oauthLogin: {
        enabled: supabaseConfigured && authOAuthProviders.length > 0,
        providers: authOAuthCatalogResponse.providers,
        defaultProvider: authOAuthCatalogResponse.defaultProvider
      },
      emailConfirmation: supabaseConfigured,
      profileUpdate: supabaseConfigured,
      providerLinking: {
        start: supabaseConfigured && authOAuthProviders.length > 0,
        unlink: supabaseConfigured && authOAuthProviders.length > 0
      },
      securityStatus: supabaseConfigured || devAuthConfig.enabled === true,
      signOutOtherSessions: supabaseConfigured,
      appProfileProjection: profileProjectionEnabled,
      devLoginAs: devAuthConfig.enabled === true
    }
  });
  const securityStatusActions = Object.freeze({
    changePassword: true,
    setPasswordEnabled: capabilities.features.password.methodToggle,
    linkProvider: capabilities.features.providerLinking.start,
    unlinkProvider: capabilities.features.providerLinking.unlink,
    signOutOtherSessions: capabilities.features.signOutOtherSessions
  });

  function buildProviderSecurityStatus(authMethodsStatus) {
    return buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus, {
      actions: securityStatusActions
    });
  }

  function normalizeOAuthProviderInput(value) {
    return normalizeOAuthProviderInputFromCatalog(value, {
      providerIds: authOAuthProviderIds,
      defaultProvider: authOAuthDefaultProvider
    });
  }

  function buildOAuthLoginRedirectUrlWithCatalog(payload) {
    return buildOAuthLoginRedirectUrl({
      ...payload,
      providerIds: authOAuthProviderIds
    });
  }

  function buildOAuthLinkRedirectUrlWithCatalog(payload) {
    return buildOAuthLinkRedirectUrl({
      ...payload,
      providerIds: authOAuthProviderIds
    });
  }

  function resolveOAuthProviderQueryParamsForProvider(providerId) {
    return resolveOAuthProviderQueryParams(providerId, {
      providerQueryParamsById: authOAuthCatalog.providerQueryParamsById
    });
  }

  function normalizeAuthReturnToTarget(value, { fallback = "/" } = {}) {
    return normalizeReturnToPath(value, {
      fallback,
      allowedOrigins: authAllowedReturnToOrigins
    });
  }

  const issuerUrl = supabaseUrl ? new URL("/auth/v1", supabaseUrl).toString().replace(/\/$/, "") : "";
  const jwksUrl = issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : "";

  let jwksResolver = null;

  function ensureConfigured() {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new AppError(500, "Auth provider is not configured.");
    }
  }

  function createSupabaseClient() {
    ensureConfigured();
    return createClient(supabaseUrl, supabasePublishableKey, buildSupabaseServerClientOptions());
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
      throw new AppError(401, "Authentication required.");
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
      throw new AppError(401, "Authentication required.");
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

    return withActor({
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
      reply.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
      reply.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
      reply.clearCookie(RECOVERY_ACCESS_TOKEN_COOKIE, clearOptions);
      reply.clearCookie(RECOVERY_REFRESH_TOKEN_COOKIE, clearOptions);
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

  function requireSynchronizedProfile(profile) {
    try {
      return requireAuthenticatedProfile(profile, {
        context: "authentication profile"
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(500, "Authentication profile synchronization failed. Please retry.");
      }
      throw error;
    }
  }

  function buildNormalizedIdentityKey(identityLike) {
    const source = identityLike && typeof identityLike === "object" ? identityLike : {};
    const authProvider = normalizeAuthProviderId(source.authProvider || authProviderId, {
      fallback: authProviderId
    });
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
    return userProfileSyncService.findByIdentity(
      {
        authProvider: normalized.authProvider,
        authProviderUserSid: normalized.authProviderUserSid
      },
      options
    );
  }

  function getSettingsProfileAuthInfo() {
    return {
      emailManagedBy: settingsProfileAuthInfo.emailManagedBy,
      emailChangeFlow: settingsProfileAuthInfo.emailChangeFlow
    };
  }

  async function syncProfileMirror(nextProfile) {
    try {
      const normalized = buildNormalizedIdentityProfile(nextProfile);
      const synchronizedProfile = await userProfileSyncService.syncIdentityProfile(normalized);
      return requireSynchronizedProfile(synchronizedProfile);
    } catch (error) {
      if (String(error?.code || "") === USER_PROFILE_EMAIL_CONFLICT_CODE) {
        throw new AppError(
          409,
          "This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security."
        );
      }

      throw error;
    }
  }

  async function syncProfileFromSupabaseUser(supabaseUser, fallbackEmail) {
    const supabaseUserId = normalizeProviderUserId(supabaseUser?.id);
    const email = normalizeEmail(supabaseUser?.email || fallbackEmail);

    if (!supabaseUserId || !email) {
      throw new AppError(500, "Auth provider user payload is missing required fields.");
    }

    return syncProfileMirror({
      authProvider: authProviderId,
      authProviderUserSid: supabaseUserId,
      email,
      displayName: resolveDisplayName(supabaseUser, email)
    });
  }

  function buildActorFromProfile(profile) {
    return normalizeAuthActor(
      {
        provider: profile?.authProvider || authProviderId,
        providerUserId: profile?.authProviderUserSid || profile?.id,
        email: profile?.email,
        displayName: profile?.displayName,
        appUserId: profileProjectionEnabled ? profile?.id : null,
        profileSource: profile?.profileSource || (profileProjectionEnabled ? "users" : "auth-provider")
      },
      {
        provider: authProviderId,
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
    return normalizeAuthResult({
      ...result,
      actor
    });
  }

  function withActorResult(operation) {
    return async (...args) => withActor(await operation(...args));
  }

  async function syncProfileFromJwtClaims(claims) {
    const supabaseUserId = normalizeProviderUserId(claims?.sub);
    if (!supabaseUserId) {
      throw new AppError(401, "Token is missing subject claim.");
    }

    const existing = await findProfileByIdentity({
      authProvider: authProviderId,
      authProviderUserSid: supabaseUserId
    });
    const emailFromToken = normalizeEmail(claims?.email || "");

    if (!emailFromToken) {
      if (existing) {
        return existing;
      }
      throw new AppError(401, "Token is missing email claim.");
    }

    return syncProfileMirror({
      authProvider: authProviderId,
      authProviderUserSid: supabaseUserId,
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
    const authMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, {
      ...passwordSignInPolicy,
      oauthProviders: authOAuthProviders
    });

    return {
      ...current,
      profile,
      passwordSignInEnabled: passwordSignInPolicy.passwordSignInEnabled,
      passwordSetupRequired: passwordSignInPolicy.passwordSetupRequired,
      authMethodsStatus
    };
  }

  async function resolveDevAuthSecurityStatus(request) {
    const devAuthResult = await authenticateDevAuthRequestFromCookies(request);
    if (!devAuthResult) {
      return null;
    }

    if (devAuthResult.authenticated !== true) {
      throw new AppError(401, "Authentication required.");
    }

    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(devAuthResult.profile.id);
    const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
      ...passwordSignInPolicy,
      oauthProviders: authOAuthProviders
    });

    return buildProviderSecurityStatus(authMethodsStatus);
  }

  const { register, resendRegisterConfirmation, login, requestOtpLogin, verifyOtpLogin, updateDisplayName } = createAccountFlows({
    ensureConfigured,
    validationError,
    getSupabaseClient,
    displayNameFromEmail,
    mapAuthError,
    syncProfileFromSupabaseUser,
    resolvePasswordSignInPolicyForUserId,
    otpLoginRedirectUrl,
    buildOtpLoginRedirectUrl,
    appPublicUrl,
    isTransientSupabaseError,
    isUserNotFoundLikeAuthError,
    mapOtpVerifyError,
    setSessionFromRequestCookies,
    mapProfileUpdateError,
    normalizeReturnToPath: normalizeAuthReturnToTarget
  });

  const { oauthStart, startProviderLink, oauthComplete, unlinkProvider } = createOauthFlows({
    ensureConfigured,
    normalizeOAuthProviderInput,
    normalizeReturnToPath: normalizeAuthReturnToTarget,
    buildOAuthLoginRedirectUrl: buildOAuthLoginRedirectUrlWithCatalog,
    appPublicUrl,
    authOAuthDefaultProvider,
    resolveOAuthProviderQueryParams: resolveOAuthProviderQueryParamsForProvider,
    getSupabaseClient,
    mapAuthError,
    setSessionFromRequestCookies,
    buildOAuthLinkRedirectUrl: buildOAuthLinkRedirectUrlWithCatalog,
    validationError,
    mapOAuthCallbackError,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    resolveCurrentAuthContext,
    buildOAuthMethodId,
    findAuthMethodById,
    findLinkedIdentityByProvider,
    buildSecurityStatusFromAuthMethodsStatus: buildProviderSecurityStatus
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
    validationError,
    getSupabaseClient,
    passwordResetRedirectUrl,
    mapAuthError,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    setSessionFromRequestCookies,
    setRecoverySessionFromRequestCookies,
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
    buildAuthMethodsStatusFromSupabaseUser: (user, statusOptions = {}) =>
      buildAuthMethodsStatusFromSupabaseUser(user, {
        ...statusOptions,
        oauthProviders: authOAuthProviders
      }),
    buildSecurityStatusFromAuthMethodsStatus: buildProviderSecurityStatus,
    authMethodPasswordProvider: AUTH_METHOD_PASSWORD_PROVIDER,
    buildAuthMethodsStatusFromProviderIds: (providerIds, statusOptions = {}) =>
      buildAuthMethodsStatusFromProviderIds(providerIds, {
        ...statusOptions,
        oauthProviders: authOAuthProviders
      }),
    resolveDevAuthSecurityStatus
  });

  async function authenticateRequest(request) {
    const { accessToken, refreshToken } = resolveRequestSessionTokens(request);

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
        const profile = await syncProfileFromJwtClaims(verification.payload);
        return withActor({
          authenticated: true,
          profile,
          clearSession: false,
          session: null,
          transientFailure: false
        });
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
          return withActor({
            authenticated: true,
            profile: supabaseVerification.profile,
            clearSession: false,
            session: null,
            transientFailure: false
          });
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

    return withActor({
      authenticated: true,
      profile,
      clearSession: false,
      session: refreshResponse.data.session,
      transientFailure: false
    });
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

  function getOAuthProviderCatalog() {
    return authOAuthCatalogResponse;
  }

  function getCapabilities() {
    return capabilities;
  }

  function isDevAuthBootstrapEnabled() {
    return devAuthConfig.enabled === true;
  }

  async function devLoginAs(request, input = {}) {
    ensureDevAuthExchangeAvailable(devAuthConfig, request);
    const rawProfile = await resolveDevAuthProfile(input, {
      userProfilesRepository,
      validationError
    });
    const profile = requireAuthenticatedProfile(rawProfile, {
      context: "dev auth profile"
    });
    return withActor({
      profile,
      session: await createDevAuthSession(profile, devAuthConfig)
    });
  }

  return {
    getCapabilities,
    register: withActorResult(register),
    resendRegisterConfirmation,
    login: withActorResult(login),
    requestOtpLogin,
    verifyOtpLogin: withActorResult(verifyOtpLogin),
    oauthStart,
    oauthComplete: withActorResult(oauthComplete),
    startProviderLink,
    requestPasswordReset,
    completePasswordRecovery: withActorResult(completePasswordRecovery),
    resetPassword,
    updateDisplayName: withActorResult(updateDisplayName),
    changePassword: withActorResult(changePassword),
    setPasswordSignInEnabled,
    unlinkProvider,
    signOutOtherSessions,
    logout,
    getSecurityStatus,
    getSettingsProfileAuthInfo,
    getOAuthProviderCatalog,
    isDevAuthBootstrapEnabled,
    devLoginAs,
    authenticateRequest,
    hasAccessTokenCookie,
    hasSessionCookie,
    writeSessionCookies,
    clearSessionCookies
  };
}

const __testables = {
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
  normalizeOAuthProviderInput: normalizeOAuthProviderInputFromCatalog,
  mapOAuthCallbackError,
  resolveSupabaseOAuthProviderCatalog,
  resolveOAuthProviderQueryParams,
  buildOAuthProviderCatalogResponse,
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  safeRequestCookies,
  cookieOptions,
  cookieClearOptions,
  isExpiredJwtError,
  classifyJwtVerifyError
};

export { createService, __testables };
