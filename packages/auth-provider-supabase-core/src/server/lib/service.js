import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { ensureDevAuthExchangeAvailable } from "@jskit-ai/auth-core/server/devAuth";
import { createSupabaseAccountFlows } from "./accountFlows.js";
import { requireAuthenticatedProfile } from "./authenticatedProfile.js";
import { createDevAuthSession, resolveDevAuthProfile } from "./devAuthBootstrap.js";
import { createSupabaseOAuthFlows } from "./oauthFlows.js";
import { createSupabasePasswordFlows } from "./passwordFlows.js";
import { SUPABASE_PROVIDER_ID, createSupabaseProfileMirror } from "./profileMirror.js";
import { createSupabaseSecurityStatus } from "./securityStatus.js";
import { createSupabaseSessions } from "./sessions.js";
import { createSupabaseClients } from "./supabaseClients.js";

const SETTINGS_PROFILE_AUTH_INFO = Object.freeze({
  emailManagedBy: SUPABASE_PROVIDER_ID,
  emailChangeFlow: SUPABASE_PROVIDER_ID
});

/**
 * The `auth.service` for Supabase Auth.
 * @param {object} dependencies
 * @param {import("../types.js").SupabaseConfig} dependencies.config
 * @param {import("../types.js").SupabaseProfiles} dependencies.profiles
 */
function createSupabaseAuthService({ config, profiles }) {
  const { configured } = config;
  const oauthOffered = configured && config.oauth.providers.length > 0;
  const capabilities = normalizeAuthCapabilities({
    provider: {
      id: SUPABASE_PROVIDER_ID,
      label: "Supabase"
    },
    features: {
      password: {
        login: configured,
        register: configured,
        change: configured,
        methodToggle: configured && config.profileMode === "users"
      },
      passwordRecovery: {
        request: configured,
        complete: configured,
        delivery: configured ? "email" : "disabled"
      },
      otp: {
        login: configured
      },
      oauthLogin: {
        enabled: oauthOffered,
        providers: config.oauthCatalog.providers,
        defaultProvider: config.oauthCatalog.defaultProvider
      },
      emailConfirmation: configured,
      profileUpdate: configured,
      providerLinking: {
        start: oauthOffered,
        unlink: oauthOffered
      },
      securityStatus: configured || config.devAuth.enabled === true,
      signOutOtherSessions: configured,
      appProfileProjection: config.profileMode === "users",
      devLoginAs: config.devAuth.enabled === true
    }
  });

  const clients = createSupabaseClients(config);
  const profileMirror = createSupabaseProfileMirror({ config, profiles });
  const sessions = createSupabaseSessions({ config, clients, profileMirror, profiles });
  const securityStatus = createSupabaseSecurityStatus({ config, capabilities, sessions, profileMirror, profiles });
  const accountFlows = createSupabaseAccountFlows({ config, clients, sessions, profileMirror, securityStatus });
  const oauthFlows = createSupabaseOAuthFlows({ config, clients, sessions, profileMirror, securityStatus });
  const passwordFlows = createSupabasePasswordFlows({ config, clients, sessions, profileMirror, securityStatus, profiles });

  function getCapabilities() {
    return capabilities;
  }

  function getSettingsProfileAuthInfo() {
    return { ...SETTINGS_PROFILE_AUTH_INFO };
  }

  function getOAuthProviderCatalog() {
    return config.oauthCatalog;
  }

  function isDevAuthBootstrapEnabled() {
    return config.devAuth.enabled === true;
  }

  async function devLoginAs(request, input) {
    ensureDevAuthExchangeAvailable(config.devAuth, request);
    const rawProfile = await resolveDevAuthProfile(input, {
      userProfilesRepository: profiles.userProfilesRepository
    });
    const profile = requireAuthenticatedProfile(rawProfile, {
      context: "dev auth profile"
    });
    return profileMirror.withActor({
      profile,
      session: await createDevAuthSession(profile, config.devAuth)
    });
  }

  return Object.freeze({
    getCapabilities,
    register: profileMirror.withActorResult(accountFlows.register),
    resendRegisterConfirmation: accountFlows.resendRegisterConfirmation,
    login: profileMirror.withActorResult(accountFlows.login),
    requestOtpLogin: accountFlows.requestOtpLogin,
    verifyOtpLogin: profileMirror.withActorResult(accountFlows.verifyOtpLogin),
    oauthStart: oauthFlows.oauthStart,
    oauthComplete: profileMirror.withActorResult(oauthFlows.oauthComplete),
    startProviderLink: oauthFlows.startProviderLink,
    requestPasswordReset: passwordFlows.requestPasswordReset,
    completePasswordRecovery: profileMirror.withActorResult(passwordFlows.completePasswordRecovery),
    resetPassword: passwordFlows.resetPassword,
    updateDisplayName: profileMirror.withActorResult(accountFlows.updateDisplayName),
    changePassword: profileMirror.withActorResult(passwordFlows.changePassword),
    // readable-check: allow setter-seam - not a slot: setPasswordSignInEnabled is an auth.service operation
    setPasswordSignInEnabled: passwordFlows.setPasswordSignInEnabled,
    unlinkProvider: oauthFlows.unlinkProvider,
    signOutOtherSessions: sessions.signOutOtherSessions,
    logout: sessions.logout,
    getSecurityStatus: securityStatus.getSecurityStatus,
    getSettingsProfileAuthInfo,
    getOAuthProviderCatalog,
    isDevAuthBootstrapEnabled,
    devLoginAs,
    authenticateRequest: sessions.authenticateRequest,
    hasAccessTokenCookie: sessions.hasAccessTokenCookie,
    hasSessionCookie: sessions.hasSessionCookie,
    writeSessionCookies: sessions.writeSessionCookies,
    clearSessionCookies: sessions.clearSessionCookies
  });
}

export { createSupabaseAuthService };
