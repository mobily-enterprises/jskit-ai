import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { assertDevAuthPolicy, resolveDevAuthPolicy } from "@jskit-ai/auth-core/server/devAuth";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { createLocalAccounts } from "./accounts.js";
import { PROVIDER_ID } from "./authPayloads.js";
import { createLocalOAuthFlows } from "./oauthFlows.js";
import { createLocalPasswordFlows } from "./passwordFlows.js";
import { normalizePasswordStrategy } from "./passwords.js";
import { createLocalSecurityStatus } from "./securityStatus.js";
import { createLocalSessions } from "./sessions.js";

/** @typedef {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} AuthProfileProjector */

// The `auth.service` of local auth. The optional collaborators are the ones
// the provider resolved once: null (or left out) when none is installed.
/**
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {ReturnType<typeof import("../providers/AuthLocalProvider.js").resolveConfig>} dependencies.config
 * @param {AuthProfileProjector} dependencies.profileProjector The `auth.profile.projector`, or noAppProfiles.
 * @param {object | null} [dependencies.passwordStrategy] The `auth.local.password-strategy`, when one is installed.
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {((delivery: { email: string, recoveryUrl: string }) => Promise<void>) | null} [dependencies.recoverySender] The `auth.local.recovery-sender`, when one is installed.
 */
function createLocalAuthService({
  backend,
  config,
  profileProjector,
  passwordStrategy,
  invitationContextResolver,
  recoverySender
}) {
  if (!config?.sessionSecret) {
    throw new Error("Local auth requires a session secret.");
  }

  if (recoverySender != null && typeof recoverySender !== "function") {
    throw new Error("auth.local.recovery-sender must be a function.");
  }

  const passwords = normalizePasswordStrategy(passwordStrategy);
  const isProduction = config.nodeEnv === "production";
  const oauthProviders = Array.isArray(config.oauthProviders) ? config.oauthProviders : [];
  const oauthProvidersById = new Map(oauthProviders.map((provider) => [provider.id, provider]));
  const oauthEnabled = oauthProviders.length > 0;
  if (oauthEnabled && !config.appPublicUrl) {
    throw new Error("Local auth OAuth sign-in requires config.appPublicUrl.");
  }
  const devAuth = config.devAuth || resolveDevAuthPolicy({
    nodeEnv: config.nodeEnv
  });
  assertDevAuthPolicy(devAuth);
  const appProfileProjection = profileProjector !== noAppProfiles;
  const recoveryDelivery = recoverySender
    ? "email"
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
        enabled: oauthEnabled,
        providers: oauthProviders.map(({ id, label }) => ({ id, label }))
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
      devLoginAs: devAuth.enabled === true && devAuth.isProduction !== true
    }
  });

  const sessions = createLocalSessions({ appProfileProjection, backend, config, devAuth, isProduction, profileProjector });
  const accounts = createLocalAccounts({
    appProfileProjection,
    backend,
    devAuth,
    invitationContextResolver,
    passwords,
    profileProjector,
    sessions
  });
  const passwordFlows = createLocalPasswordFlows({
    backend,
    config,
    isProduction,
    passwords,
    profileProjector,
    recoveryEnabled,
    recoverySender,
    sessions
  });
  const securityStatus = createLocalSecurityStatus({ backend, oauthEnabled, oauthProviders, oauthProvidersById, sessions });
  const oauthFlows = createLocalOAuthFlows({
    backend,
    config,
    isProduction,
    oauthEnabled,
    oauthProvidersById,
    profileProjector,
    securityStatus,
    sessions
  });

  function getCapabilities() {
    return capabilities;
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
    resendRegisterConfirmation() {
      return throwUnsupportedAuthOperation("resendRegisterConfirmation");
    },
    login: accounts.login,
    requestOtpLogin() {
      return throwUnsupportedAuthOperation("requestOtpLogin");
    },
    verifyOtpLogin() {
      return throwUnsupportedAuthOperation("verifyOtpLogin");
    },
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
    setPasswordSignInEnabled() {
      return throwUnsupportedAuthOperation("setPasswordSignInEnabled");
    },
    startProviderLink: oauthFlows.startProviderLink,
    unlinkProvider: oauthFlows.unlinkProvider,
    signOutOtherSessions: sessions.signOutOtherSessions,
    logout: sessions.logout
  });
}

export { createLocalAuthService };
