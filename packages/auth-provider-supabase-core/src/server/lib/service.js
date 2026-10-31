import { createClient } from "@supabase/supabase-js";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { ensureDevAuthExchangeAvailable } from "@jskit-ai/auth-core/server/devAuth";
import { AUTH_METHOD_PASSWORD_PROVIDER } from "@jskit-ai/auth-core/shared/authMethods";
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
import { isExpiredJwtError, classifyJwtVerifyError } from "./authJwt.js";
import { createAccountFlows } from "./accountFlows.js";
import { createSupabaseOAuthFlows } from "./oauthFlows.js";
import { createPasswordSecurityFlows } from "./passwordSecurityFlows.js";
import { DEFAULT_AUTH_PROVIDER_ID, createProfileMirror, normalizeAuthProviderId } from "./profileMirror.js";
import { createSupabaseSessions } from "./sessions.js";
import { buildSupabaseServerClientOptions } from "./supabaseClientOptions.js";
import {
  assertDevAuthBootstrapConfig,
  createDevAuthSession,
  resolveDevAuthConfig,
  resolveDevAuthProfile
} from "./devAuthBootstrap.js";
import { requireAuthenticatedProfile } from "./authenticatedProfile.js";
import {
  buildOAuthProviderCatalogResponse,
  resolveOAuthProviderQueryParams,
  resolveSupabaseOAuthProviderCatalog
} from "./oauthProviderCatalog.js";

const DEFAULT_AUDIENCE = "authenticated";

/**
 * The `auth.service` for Supabase Auth.
 * @param {object} options
 * @param {{ id: string, supabaseUrl?: string, supabasePublishableKey?: string, jwtAudience?: string, emailManagedBy?: string, emailChangeFlow?: string, oauthProviderCatalog?: any, oauthProviders?: any, oauthDefaultProvider?: string, oauthProviderLabels?: any, oauthProviderQueryParams?: any }} options.authProvider
 * @param {import("@jskit-ai/users-core/server/types").UsersIdentity["repositories"]["userSettings"] | null} options.userSettingsRepository The users' settings when profiles live in the users table, else null.
 * @param {import("@jskit-ai/users-core/server/types").UsersIdentity["repositories"]["userProfiles"] | null} options.userProfilesRepository The users' profiles when profiles live in the users table, else null.
 * @param {Required<Pick<import("@jskit-ai/auth-core/server/types").AuthProfileProjector, "syncIdentityProfile" | "findByIdentity">>} options.userProfileSyncService
 * @param {boolean} [options.profileProjectionEnabled]
 * @param {string} [options.nodeEnv]
 * @param {string} [options.appPublicUrl]
 * @param {string[]} [options.authAllowedReturnToOrigins]
 * @param {any} [options.authOAuthProviderCatalog]
 * @param {any} [options.authOAuthProviders]
 * @param {string} [options.authOAuthDefaultProvider]
 * @param {any} [options.authOAuthProviderLabels]
 * @param {any} [options.authOAuthProviderQueryParams]
 * @param {any} [options.devAuthBypassEnabled] The raw AUTH_DEV_BYPASS_ENABLED setting.
 * @param {string} [options.devAuthBypassSecret]
 * @param {any} [options.devAuthAccessTtlSeconds]
 * @param {any} [options.devAuthRefreshTtlSeconds]
 */
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
  const userSettingsRepository = options.userSettingsRepository;
  const passwordMethodToggleSupported = Boolean(userSettingsRepository);
  const userProfilesRepository = options.userProfilesRepository;
  const userProfileSyncService = options.userProfileSyncService;
  const profileProjectionEnabled = options.profileProjectionEnabled === true;
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
        delivery: supabaseConfigured ? "email" : "disabled"
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
    // readable-check: allow setter-seam - not a slot: setPasswordEnabled says whether the security screen offers the toggle
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

  function ensureConfigured() {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new AppError(500, "Auth provider is not configured.", { code: "auth.supabase.config.missing" });
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

  const profileMirror = createProfileMirror({ authProviderId, profileProjectionEnabled, userProfileSyncService });
  const sessions = createSupabaseSessions({
    devAuthConfig,
    ensureConfigured,
    getSupabaseClient,
    isProduction,
    jwtAudience,
    profileMirror,
    supabaseUrl,
    userProfilesRepository
  });

  function getSettingsProfileAuthInfo() {
    return {
      emailManagedBy: settingsProfileAuthInfo.emailManagedBy,
      emailChangeFlow: settingsProfileAuthInfo.emailChangeFlow
    };
  }

  async function resolvePasswordSignInPolicyForUserId(userId) {
    if (!userSettingsRepository) {
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
    if (!userSettingsRepository) {
      throw new AppError(500, "Password sign-in settings repository is not configured.", {
        code: "auth.supabase.config.passwordSettingsMissing"
      });
    }

    const updated = await userSettingsRepository.updatePasswordSignInEnabled(userId, enabled, options);
    return {
      passwordSignInEnabled: updated.passwordSignInEnabled !== false,
      passwordSetupRequired: updated.passwordSetupRequired === true
    };
  }

  async function setPasswordSetupRequiredForUserId(userId, required) {
    if (!userSettingsRepository) {
      return;
    }

    await userSettingsRepository.updatePasswordSetupRequired(userId, required);
  }

  async function resolveCurrentAuthContext(request, options = {}) {
    const current = await sessions.resolveCurrentSupabaseUser(request, options);
    const profile = await profileMirror.syncProfileFromSupabaseUser(current.user, current.user?.email || "");
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
    const devAuthResult = await sessions.authenticateDevAuthRequestFromCookies(request);
    if (!devAuthResult) {
      return null;
    }

    if (devAuthResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }

    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(devAuthResult.actor.id);
    const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
      ...passwordSignInPolicy,
      oauthProviders: authOAuthProviders
    });

    return buildProviderSecurityStatus(authMethodsStatus);
  }

  const { register, resendRegisterConfirmation, login, requestOtpLogin, verifyOtpLogin, updateDisplayName } = createAccountFlows({
    appPublicUrl,
    ensureConfigured,
    getSupabaseClient,
    normalizeReturnToPath: normalizeAuthReturnToTarget,
    otpLoginRedirectUrl,
    resolvePasswordSignInPolicyForUserId,
    setSessionFromRequestCookies: sessions.setSessionFromRequestCookies,
    syncProfileFromSupabaseUser: profileMirror.syncProfileFromSupabaseUser
  });

  const { oauthStart, startProviderLink, oauthComplete, unlinkProvider } = createSupabaseOAuthFlows({
    appPublicUrl,
    authOAuthDefaultProvider,
    buildOAuthLinkRedirectUrl: buildOAuthLinkRedirectUrlWithCatalog,
    buildOAuthLoginRedirectUrl: buildOAuthLoginRedirectUrlWithCatalog,
    buildProviderSecurityStatus,
    ensureConfigured,
    getSupabaseClient,
    normalizeOAuthProviderInput,
    normalizeReturnToPath: normalizeAuthReturnToTarget,
    resolveCurrentAuthContext,
    resolveOAuthProviderQueryParams: resolveOAuthProviderQueryParamsForProvider,
    setSessionFromRequestCookies: sessions.setSessionFromRequestCookies,
    syncProfileFromSupabaseUser: profileMirror.syncProfileFromSupabaseUser
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
    authOAuthProviders,
    buildProviderSecurityStatus,
    createStatelessSupabaseClient,
    ensureConfigured,
    getSupabaseClient,
    passwordResetRedirectUrl,
    resolveCurrentAuthContext,
    resolveDevAuthSecurityStatus,
    resolvePasswordSignInPolicyForUserId,
    setPasswordSignInEnabledForUserId,
    setPasswordSetupRequiredForUserId,
    setRecoverySessionFromRequestCookies: sessions.setRecoverySessionFromRequestCookies,
    setSessionFromRequestCookies: sessions.setSessionFromRequestCookies,
    syncProfileFromSupabaseUser: profileMirror.syncProfileFromSupabaseUser
  });

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
    return profileMirror.withActor({
      profile,
      session: await createDevAuthSession(profile, devAuthConfig)
    });
  }

  return {
    getCapabilities,
    register: profileMirror.withActorResult(register),
    resendRegisterConfirmation,
    login: profileMirror.withActorResult(login),
    requestOtpLogin,
    verifyOtpLogin: profileMirror.withActorResult(verifyOtpLogin),
    oauthStart,
    oauthComplete: profileMirror.withActorResult(oauthComplete),
    startProviderLink,
    requestPasswordReset,
    completePasswordRecovery: profileMirror.withActorResult(completePasswordRecovery),
    resetPassword,
    updateDisplayName: profileMirror.withActorResult(updateDisplayName),
    changePassword: profileMirror.withActorResult(changePassword),
    // readable-check: allow setter-seam - not a slot: setPasswordSignInEnabled is an auth.service operation
    setPasswordSignInEnabled,
    unlinkProvider,
    signOutOtherSessions,
    logout: sessions.logout,
    getSecurityStatus,
    getSettingsProfileAuthInfo,
    getOAuthProviderCatalog,
    isDevAuthBootstrapEnabled,
    devLoginAs,
    authenticateRequest: sessions.authenticateRequest,
    hasAccessTokenCookie: sessions.hasAccessTokenCookie,
    hasSessionCookie: sessions.hasSessionCookie,
    writeSessionCookies: sessions.writeSessionCookies,
    clearSessionCookies: sessions.clearSessionCookies
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
