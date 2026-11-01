import { AUTH_TEXTS, createAuthError } from "@jskit-ai/auth-core/server/authTexts";
import { AUTH_METHOD_PASSWORD_PROVIDER } from "@jskit-ai/auth-core/shared/authMethods";
import {
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus
} from "./authMethodStatus.js";

/**
 * The sign-in methods of the signed-in account: its password, whether it may
 * sign in with it, and each linked OAuth provider, with the actions this app
 * offers on them.
 * @param {object} dependencies
 * @param {import("./types.js").SupabaseConfig} dependencies.config
 * @param {import("@jskit-ai/auth-core/server/types").AuthCapabilities} dependencies.capabilities
 * @param {import("./types.js").SupabaseSessions} dependencies.sessions
 * @param {import("./types.js").SupabaseProfileMirror} dependencies.profileMirror
 * @param {import("./types.js").SupabaseProfiles} dependencies.profiles
 */
function createSupabaseSecurityStatus({ config, capabilities, sessions, profileMirror, profiles }) {
  const { features } = capabilities;
  const actions = Object.freeze({
    changePassword: true,
    // readable-check: allow setter-seam - not a slot: setPasswordEnabled says whether the security screen offers the toggle
    setPasswordEnabled: features.password.methodToggle,
    linkProvider: features.providerLinking.start,
    unlinkProvider: features.providerLinking.unlink,
    signOutOtherSessions: features.signOutOtherSessions
  });

  function buildSecurityStatus(authMethodsStatus) {
    return buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus, { actions });
  }

  async function passwordSignInPolicyForUser(userId) {
    const settings = await profiles.userSettingsRepository.ensureForUserId(userId);
    return {
      passwordSignInEnabled: settings?.passwordSignInEnabled !== false,
      passwordSetupRequired: settings?.passwordSetupRequired === true
    };
  }

  /** The signed-in Supabase user, its app profile and its sign-in methods. */
  async function currentAuthContext(request, options = {}) {
    const current = await sessions.resolveCurrentSupabaseUser(request, options);
    const profile = await profileMirror.syncProfileFromSupabaseUser(current.user, current.user?.email || "");
    const passwordSignInPolicy = await passwordSignInPolicyForUser(profile.id);
    const authMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, {
      ...passwordSignInPolicy,
      oauthProviders: config.oauth.providers
    });

    return {
      ...current,
      profile,
      passwordSignInEnabled: passwordSignInPolicy.passwordSignInEnabled,
      passwordSetupRequired: passwordSignInPolicy.passwordSetupRequired,
      authMethodsStatus
    };
  }

  /** The security status of a dev auth session, or null for any other request. */
  async function devAuthSecurityStatus(request) {
    const devAuthResult = await sessions.authenticateDevAuthRequestFromCookies(request);
    if (!devAuthResult) {
      return null;
    }

    if (devAuthResult.authenticated !== true) {
      throw createAuthError(AUTH_TEXTS.sessionRequired);
    }

    const passwordSignInPolicy = await passwordSignInPolicyForUser(devAuthResult.actor.id);
    const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
      ...passwordSignInPolicy,
      oauthProviders: config.oauth.providers
    });

    return buildSecurityStatus(authMethodsStatus);
  }

  async function getSecurityStatus(request) {
    if (!request) {
      const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
        passwordSignInEnabled: true,
        passwordSetupRequired: false,
        oauthProviders: config.oauth.providers
      });
      return buildSecurityStatus(authMethodsStatus);
    }

    const devAuthStatus = await devAuthSecurityStatus(request);
    if (devAuthStatus) {
      return devAuthStatus;
    }

    const current = await currentAuthContext(request);
    return buildSecurityStatus(current.authMethodsStatus);
  }

  return Object.freeze({
    buildSecurityStatus,
    passwordSignInPolicyForUser,
    currentAuthContext,
    getSecurityStatus
  });
}

export { createSupabaseSecurityStatus };
