import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import { isDevAuthBootstrapEnabled } from "@jskit-ai/auth-core/server/devAuth";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { throwUnsupportedAuthOperation } from "@jskit-ai/auth-core/server/unsupportedOperation";
import { createLocalAccounts } from "./accounts.js";
import { PROVIDER_ID } from "./authPayloads.js";
import { createLocalDeliveries } from "./deliveries.js";
import { createLocalEmailChange } from "./emailChange.js";
import { confirmEveryRegistrationByLink, createLocalEmailConfirmation } from "./emailConfirmation.js";
import { createFirstAccountSetup } from "./firstAccountSetup.js";
import { createLocalOAuthFlows } from "./oauthFlows.js";
import { createLocalPassSignIn, noPassIdentities } from "./passSignIn.js";
import { createLocalPasswordFlows } from "./passwordFlows.js";
import { normalizePasswordStrategy } from "./passwords.js";
import { createLocalSecondFactor } from "./secondFactor.js";
import { createLocalSecurityStatus } from "./securityStatus.js";
import { createLocalSessions } from "./sessions.js";

// A staging or production server without AUTH_LOCAL_SECOND_FACTOR_KEY has no second factor: each operation is unsupported.
const NO_SECOND_FACTOR = Object.freeze({
  getSecondFactorStatus: () => throwUnsupportedAuthOperation("getSecondFactorStatus"),
  startSecondFactorSetup: () => throwUnsupportedAuthOperation("startSecondFactorSetup"),
  confirmSecondFactorSetup: () => throwUnsupportedAuthOperation("confirmSecondFactorSetup"),
  verifySecondFactor: () => throwUnsupportedAuthOperation("verifySecondFactor"),
  replaceSecondFactorRecoveryCodes: () => throwUnsupportedAuthOperation("replaceSecondFactorRecoveryCodes"),
  removeSecondFactor: () => throwUnsupportedAuthOperation("removeSecondFactor"),
  listSecondFactors: () => throwUnsupportedAuthOperation("listSecondFactors"),
  resetSecondFactor: () => throwUnsupportedAuthOperation("resetSecondFactor")
});

// Without AUTH_PASS_PUBLIC_KEY no pass signs anyone in.
const NO_PASS_SIGN_IN = Object.freeze({
  signInWithPass: () => throwUnsupportedAuthOperation("signInWithPass")
});

/**
 * The `auth.service` of local auth, from the collaborators its provider
 * resolved once.
 * @param {object} dependencies
 * @param {import("../types.js").AuthLocalBackend} dependencies.backend
 * @param {import("../types.js").AuthLocalConfig} dependencies.config
 * @param {import("../types.js").AuthLocalConfirmationMode} [dependencies.confirmationMode] The
 *   `auth.local.confirmation-mode`; by default every registration waits for its link.
 * @param {import("../types.js").AuthLocalConfirmationSender} dependencies.confirmationSender The
 *   `auth.local.confirmation-sender`, or one made by createLoggedConfirmationSender.
 * @param {import("../types.js").AuthLocalDeliveries} [dependencies.deliveries] Sends the password reset, new
 *   confirmation link and email change emails, and hands over the sign-in events, after their requests have answered;
 *   by default, its own, whose settled() nothing waits for. The provider passes the one its shutdown waits for.
 * @param {import("../types.js").AuthLocalEmailChangeSender} dependencies.emailChangeSender The
 *   `auth.local.email-change-sender`, or one made by createLoggedEmailChangeSender.
 * @param {import("../types.js").AuthLocalFirstAccountSetup} [dependencies.firstAccountSetup] The first
 *   account's setup code, already started by the provider; by default, one that starts on first use.
 * @param {import("@jskit-ai/auth-core/server/types").AuthInvitationContextResolver} dependencies.invitationContextResolver
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {import("../types.js").AuthLocalPassIdentity} [dependencies.passIdentity] The `auth.local.pass-identity`,
 *   which names the account a one-time pass signs in; by default none, so every pass is refused as unmapped.
 * @param {import("../types.js").AuthLocalPasswordStrategy} dependencies.passwordStrategy The
 *   `auth.local.password-strategy`, or scryptPasswordStrategy.
 * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector} dependencies.profileProjector The
 *   `auth.profile.projector`, or noAppProfiles.
 * @param {import("../types.js").AuthLocalRecoverySender} dependencies.recoverySender The
 *   `auth.local.recovery-sender`, or one made by createLoggedRecoverySender.
 * @param {import("../types.js").AuthLocalSecondFactorEvents} dependencies.secondFactorEvents The
 *   `auth.local.second-factor-events`, or one made by createLoggedSecondFactorEvents.
 * @param {import("../types.js").AuthLocalSignInEvents} dependencies.signInEvents The `auth.local.sign-in-events`, or
 *   one made by createLoggedSignInEvents; it is given each event through `deliveries`.
 */
function createLocalAuthService({
  backend,
  config,
  confirmationMode = confirmEveryRegistrationByLink,
  confirmationSender,
  deliveries: givenDeliveries = null,
  emailChangeSender,
  firstAccountSetup: givenFirstAccountSetup = null,
  invitationContextResolver,
  logger,
  passIdentity = noPassIdentities,
  passwordStrategy,
  profileProjector,
  recoverySender,
  secondFactorEvents,
  signInEvents
}) {
  const passwords = normalizePasswordStrategy(passwordStrategy);
  const firstAccountSetup = givenFirstAccountSetup ?? createFirstAccountSetup({ backend, config, logger });
  const deliveries = givenDeliveries ?? createLocalDeliveries({ logger });
  const oauthProvidersById = new Map(config.oauthProviders.map((provider) => [provider.id, provider]));
  const { oauthEnabled, recoveryEnabled } = config;
  const appProfileProjection = profileProjector !== noAppProfiles;
  const capabilities = normalizeAuthCapabilities({
    provider: {
      id: PROVIDER_ID,
      label: "Local"
    },
    features: {
      password: {
        login: true,
        register: true,
        // Off with AUTH_LOCAL_SELF_REGISTRATION=false: an account registers by invitation, or as the first one.
        selfRegister: config.selfRegistration,
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
      emailConfirmation: config.emailConfirmation,
      emailConfirmationCode: config.emailConfirmation,
      // Off in staging and production without an auth.local.email-change-sender, which sends the links.
      emailChange: config.emailChangeDelivery !== "off",
      profileUpdate: true,
      providerLinking: {
        start: oauthEnabled,
        unlink: oauthEnabled
      },
      securityStatus: true,
      signOutOtherSessions: true,
      appProfileProjection,
      devLoginAs: isDevAuthBootstrapEnabled(config.devAuth),
      secondFactor: Boolean(config.secondFactorKey)
    }
  });
  // While the app has no account, its first one may register, and on a staging or production server that asks for the setup code.
  const capabilitiesForFirstAccount = normalizeAuthCapabilities({
    ...capabilities,
    features: { ...capabilities.features, password: { ...capabilities.features.password, selfRegister: true } }
  });
  const capabilitiesWaitingForFirstAccount = normalizeAuthCapabilities({
    ...capabilitiesForFirstAccount,
    features: { ...capabilitiesForFirstAccount.features, firstAccountSetupCode: true }
  });

  const sessions = createLocalSessions({ appProfileProjection, backend, config, deliveries, profileProjector, signInEvents });
  const emailConfirmation = createLocalEmailConfirmation({
    backend,
    config,
    confirmationMode,
    confirmationSender,
    deliveries,
    firstAccountSetup,
    invitationContextResolver,
    logger,
    passwords,
    profileProjector,
    sessions
  });
  const accounts = createLocalAccounts({
    appProfileProjection,
    backend,
    config,
    emailConfirmation,
    firstAccountSetup,
    invitationContextResolver,
    passwords,
    profileProjector,
    sessions
  });
  const passwordFlows = createLocalPasswordFlows({
    backend,
    config,
    deliveries,
    passwords,
    profileProjector,
    recoverySender,
    sessions
  });
  const emailChange = createLocalEmailChange({
    backend,
    config,
    deliveries,
    emailChangeSender,
    passwords,
    profileProjector,
    sessions
  });
  const securityStatus = createLocalSecurityStatus({ backend, config, oauthProvidersById, sessions });
  const oauthFlows = createLocalOAuthFlows({
    backend,
    config,
    firstAccountSetup,
    logger,
    oauthProvidersById,
    profileProjector,
    securityStatus,
    sessions
  });

  const secondFactor = config.secondFactorKey
    ? createLocalSecondFactor({ backend, config, logger, secondFactorEvents, sessions })
    : NO_SECOND_FACTOR;

  const passSignIn = config.passSignIn
    ? createLocalPassSignIn({ backend, config, passIdentity, profileProjector, sessions })
    : NO_PASS_SIGN_IN;

  function getCapabilities() {
    if (firstAccountSetup.isWaiting()) {
      return capabilitiesWaitingForFirstAccount;
    }
    return firstAccountSetup.isOwnerless() ? capabilitiesForFirstAccount : capabilities;
  }

  function resendRegisterConfirmation(input) {
    if (!config.emailConfirmation) {
      return throwUnsupportedAuthOperation("resendRegisterConfirmation");
    }
    return emailConfirmation.resend(input);
  }

  function confirmRegistration(input, request = null) {
    if (!config.emailConfirmation) {
      return throwUnsupportedAuthOperation("confirmRegistration");
    }
    return emailConfirmation.confirm(input, request);
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
    confirmRegistration,
    login: accounts.login,
    signInWithPass: passSignIn.signInWithPass,
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
    requestEmailChange: emailChange.requestEmailChange,
    requestEmailChangeForUser: emailChange.requestEmailChangeForUser,
    confirmEmailChange: emailChange.confirmEmailChange,
    getSecurityStatus: securityStatus.getSecurityStatus,
    // readable-check: allow setter-seam - not a slot: setPasswordSignInEnabled is an auth.service operation
    setPasswordSignInEnabled,
    startProviderLink: oauthFlows.startProviderLink,
    unlinkProvider: oauthFlows.unlinkProvider,
    signOutOtherSessions: sessions.signOutOtherSessions,
    logout: sessions.logout,
    getSecondFactorStatus: secondFactor.getSecondFactorStatus,
    startSecondFactorSetup: secondFactor.startSecondFactorSetup,
    confirmSecondFactorSetup: secondFactor.confirmSecondFactorSetup,
    verifySecondFactor: secondFactor.verifySecondFactor,
    replaceSecondFactorRecoveryCodes: secondFactor.replaceSecondFactorRecoveryCodes,
    removeSecondFactor: secondFactor.removeSecondFactor,
    listSecondFactors: secondFactor.listSecondFactors,
    resetSecondFactor: secondFactor.resetSecondFactor
  });
}

export { createLocalAuthService };
