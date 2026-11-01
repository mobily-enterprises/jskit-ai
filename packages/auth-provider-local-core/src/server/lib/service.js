import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { isDevAuthBootstrapEnabled } from "@jskit-ai/auth-core/server/devAuth";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { createLocalAccounts } from "./accounts.js";
import { PROVIDER_ID } from "./authPayloads.js";
import { createLocalOAuthFlows } from "./oauthFlows.js";
import { createLocalPasswordFlows } from "./passwordFlows.js";
import { normalizePasswordStrategy } from "./passwords.js";
import { createLocalSecurityStatus } from "./securityStatus.js";
import { createLocalSessions } from "./sessions.js";

/**
 * The `auth.service` of local auth, from the collaborators its provider
 * resolved once.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("../types.js").AuthLocalPasswordStrategy} dependencies.passwordStrategy The
 *   `auth.local.password-strategy`, or scryptPasswordStrategy.
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector The
 *   `auth.profile.projector`, or noAppProfiles.
 * @param {import("../types.js").AuthLocalRecoverySender} dependencies.recoverySender The
 *   `auth.local.recovery-sender`, or one made by createLoggedRecoverySender.
 */
function createLocalAuthService({
  backend,
  config,
  invitationContextResolver,
  logger,
  passwordStrategy,
  profileProjector,
  recoverySender
}) {
  const passwords = normalizePasswordStrategy(passwordStrategy);
  const oauthProvidersById = new Map(config.oauthProviders.map((provider) => [provider.id, provider]));
  const oauthEnabled = config.oauthProviders.length > 0;
  const appProfileProjection = profileProjector !== noAppProfiles;
  const recoveryEnabled = config.recoveryDelivery !== "disabled";
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
        delivery: config.recoveryDelivery
      },
      otp: {
        login: false
      },
      oauthLogin: {
        enabled: oauthEnabled,
        providers: config.oauthProviders.map(({ id, label }) => ({ id, label }))
      },
      emailConfirmation: false,
      profileUpdate: true,
      providerLinking: {
        start: oauthEnabled,
        unlink: oauthEnabled
      },
      securityStatus: true,
      signOutOtherSessions: true,
      appProfileProjection,
      devLoginAs: isDevAuthBootstrapEnabled(config.devAuth)
    }
  });

  const sessions = createLocalSessions({ appProfileProjection, backend, config, profileProjector });
  const accounts = createLocalAccounts({
    appProfileProjection,
    backend,
    config,
    invitationContextResolver,
    passwords,
    profileProjector,
    sessions
  });
  const passwordFlows = createLocalPasswordFlows({
    backend,
    config,
    passwords,
    profileProjector,
    recoverySender,
    sessions
  });
  const securityStatus = createLocalSecurityStatus({ backend, config, oauthProvidersById, sessions });
  const oauthFlows = createLocalOAuthFlows({
    backend,
    config,
    logger,
    oauthProvidersById,
    profileProjector,
    securityStatus,
    sessions
  });

  function getCapabilities() {
    return capabilities;
  }

  function resendRegisterConfirmation() {
    return throwUnsupportedAuthOperation("resendRegisterConfirmation");
  }

  function requestOtpLogin() {
    return throwUnsupportedAuthOperation("requestOtpLogin");
  }

  function verifyOtpLogin() {
    return throwUnsupportedAuthOperation("verifyOtpLogin");
  }

  function setPasswordSignInEnabled() {
    return throwUnsupportedAuthOperation("setPasswordSignInEnabled");
  }

  return Object.freeze({
    getCapabilities,
    isDevAuthBootstrapEnabled: accounts.isDevAuthBootstrapEnabled,
    devLoginAs: accounts.devLoginAs,
    authenticateRequest: sessions.authenticateRequest,
    hasAccessTokenCookie: sessions.hasAccessTokenCookie,
    hasSessionCookie: sessions.hasSessionCookie,
    writeSessionCookies: sessions.writeSessionCookies,
    clearSessionCookies: sessions.clearSessionCookies,
    register: accounts.register,
    resendRegisterConfirmation,
    login: accounts.login,
    requestOtpLogin,
    verifyOtpLogin,
    writeOAuthStartCookies: oauthFlows.writeOAuthStartCookies,
    clearOAuthStartCookies: oauthFlows.clearOAuthStartCookies,
    oauthStart: oauthFlows.oauthStart,
    oauthComplete: oauthFlows.oauthComplete,
    requestPasswordReset: passwordFlows.requestPasswordReset,
    completePasswordRecovery: passwordFlows.completePasswordRecovery,
    resetPassword: passwordFlows.resetPassword,
    changePassword: passwordFlows.changePassword,
    updateDisplayName: accounts.updateDisplayName,
    getSecurityStatus: securityStatus.getSecurityStatus,
    // readable-check: allow setter-seam - not a slot: setPasswordSignInEnabled is an auth.service operation
    setPasswordSignInEnabled,
    startProviderLink: oauthFlows.startProviderLink,
    unlinkProvider: oauthFlows.unlinkProvider,
    signOutOtherSessions: sessions.signOutOtherSessions,
    logout: sessions.logout
  });
}

export { createLocalAuthService };
