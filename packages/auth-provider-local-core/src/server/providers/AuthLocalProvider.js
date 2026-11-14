import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { deliverMessage } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { resolveLocalAuthConfig } from "../lib/config.js";
import { DELIVERY_SHUTDOWN_WAIT_MS, createLocalDeliveries } from "../lib/deliveries.js";
import {
  confirmEveryRegistrationByLink,
  createLoggedConfirmationSender
} from "../lib/emailConfirmation.js";
import { createLoggedEmailChangeSender } from "../lib/emailChange.js";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { createFirstAccountSetup } from "../lib/firstAccountSetup.js";
import { noPassIdentities } from "../lib/passSignIn.js";
import { createLoggedRecoverySender } from "../lib/passwordFlows.js";
import { scryptPasswordStrategy } from "../lib/passwords.js";
import { createLoggedSecondFactorEvents } from "../lib/secondFactor.js";
import { createLocalAuthService } from "../lib/service.js";
import { createLoggedSignInEvents } from "../lib/sessions.js";

// The emails each started auth service is still sending, by the service its setup gave out, for its shutdown.
const deliveriesByService = new WeakMap();

/**
 * An installed email sender, sending as APP_ENV says (`deliverMessage`): production sends each email to its address;
 * staging only to STAGING_EMAIL_TO, passing the address it was for as `originalEmail`, or logs it when that is unset;
 * development and test log it, link included, which the person testing follows.
 * @template {{ email: string }} D
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {(delivery: D & { originalEmail: string }) => Promise<void>} dependencies.sender
 * @param {string} dependencies.name What the email is, such as "password reset".
 * @returns {(delivery: D) => Promise<void>}
 */
function sendAsAppEnvironmentSays({ env, logger, sender, name }) {
  return async (delivery) => {
    const { email, ...link } = delivery;
    await deliverMessage({
      env,
      logger,
      channel: "email",
      to: email,
      summary: `the ${name} email to ${email}`,
      details: link,
      send: (to, { originalTo }) => sender({ ...delivery, email: to, originalEmail: originalTo })
    });
  };
}

const AuthLocalProvider = defineProvider({
  id: "auth.local",
  requires: {
    appRoot: "runtime.app-root",
    env: "runtime.env",
    extensions: "auth.extensions",
    logger: "runtime.logger"
  },
  optional: {
    backend: "auth.local.backend",
    confirmationMode: "auth.local.confirmation-mode",
    confirmationSender: "auth.local.confirmation-sender",
    emailChangeSender: "auth.local.email-change-sender",
    passIdentity: "auth.local.pass-identity",
    passwordStrategy: "auth.local.password-strategy",
    profileProjector: "auth.profile.projector",
    recoverySender: "auth.local.recovery-sender",
    secondFactorEvents: "auth.local.second-factor-events",
    signInEvents: "auth.local.sign-in-events"
  },
  provides: {
    authService: "auth.service"
  },
  setup() {
    return { authService: createDeferredAuthService() };
  },
  /**
   * @param {object} dependencies
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot} dependencies.appRoot
   * @param {import("../types.js").AuthLocalBackend | null} dependencies.backend The `auth.local.backend`, when one is installed.
   * @param {import("../types.js").AuthLocalConfirmationMode | null} dependencies.confirmationMode The
   *   `auth.local.confirmation-mode`, when one is installed.
   * @param {import("../types.js").AuthLocalConfirmationSender | null} dependencies.confirmationSender The
   *   `auth.local.confirmation-sender`, when one is installed.
   * @param {import("../types.js").AuthLocalEmailChangeSender | null} dependencies.emailChangeSender The
   *   `auth.local.email-change-sender`, when one is installed.
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   * @param {import("../types.js").AuthLocalPassIdentity | null} dependencies.passIdentity The `auth.local.pass-identity`,
   *   when one is installed: required while AUTH_PASS_PUBLIC_KEY turns on pass sign-in.
   * @param {import("../types.js").AuthLocalPasswordStrategy | null} dependencies.passwordStrategy The `auth.local.password-strategy`, when one is installed.
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The `auth.profile.projector`, when one is installed.
   * @param {import("../types.js").AuthLocalRecoverySender | null} dependencies.recoverySender The `auth.local.recovery-sender`, when one is installed.
   * @param {import("../types.js").AuthLocalSecondFactorEvents | null} dependencies.secondFactorEvents The
   *   `auth.local.second-factor-events`, when one is installed.
   * @param {import("../types.js").AuthLocalSignInEvents | null} dependencies.signInEvents The
   *   `auth.local.sign-in-events`, when one is installed.
   */
  async boot(
    {
      appRoot,
      backend,
      confirmationMode,
      confirmationSender,
      emailChangeSender,
      env,
      extensions,
      logger,
      passIdentity,
      passwordStrategy,
      profileProjector,
      recoverySender,
      secondFactorEvents,
      signInEvents
    },
    { outputs }
  ) {
    const fileBackend = backend === null;
    const emailRecovery = recoverySender !== null;
    const emailConfirmationSender = confirmationSender !== null;
    const emailedChange = emailChangeSender !== null;
    const config = resolveLocalAuthConfig({
      appRoot,
      env,
      fileBackend,
      emailRecovery,
      emailConfirmationSender,
      emailChangeSender: emailedChange
    });
    if (config.passSignIn && passIdentity === null) {
      throw new Error("AUTH_PASS_PUBLIC_KEY turns on one-time pass sign-in, and no auth.local.pass-identity is installed to name the account each pass signs in. Install one, or unset AUTH_PASS_PUBLIC_KEY.");
    }
    const localBackend = fileBackend ? createLocalFileBackend({ storeDir: config.storeDir }) : backend;
    // A staging or production server without accounts logs its setup code as it starts.
    const firstAccountSetup = createFirstAccountSetup({ backend: localBackend, config, logger });
    await firstAccountSetup.start();
    // An installed sender sends as APP_ENV says: only production emails each address; staging emails only
    // STAGING_EMAIL_TO; development and test log each email. The confirmation mode sends nothing, so it applies
    // everywhere.
    const deliveries = createLocalDeliveries({ logger });
    deliveriesByService.set(outputs.authService, deliveries);
    const baseService = createLocalAuthService({
      backend: localBackend,
      config,
      confirmationMode: confirmationMode ?? confirmEveryRegistrationByLink,
      confirmationSender: emailConfirmationSender
        ? sendAsAppEnvironmentSays({ env, logger, sender: confirmationSender, name: "email confirmation" })
        : createLoggedConfirmationSender(logger),
      deliveries,
      emailChangeSender: emailedChange
        ? sendAsAppEnvironmentSays({ env, logger, sender: emailChangeSender, name: "email change" })
        : createLoggedEmailChangeSender(logger),
      firstAccountSetup,
      invitationContextResolver: extensions.resolveInvitationContextResolver(),
      logger,
      passIdentity: passIdentity ?? noPassIdentities,
      passwordStrategy: passwordStrategy ?? scryptPasswordStrategy,
      profileProjector: profileProjector ?? noAppProfiles,
      recoverySender: emailRecovery
        ? sendAsAppEnvironmentSays({ env, logger, sender: recoverySender, name: "password reset" })
        : createLoggedRecoverySender(logger),
      secondFactorEvents: secondFactorEvents ?? createLoggedSecondFactorEvents(logger),
      signInEvents: signInEvents ?? createLoggedSignInEvents(logger)
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  },
  /**
   * Waits for the emails local auth is still sending, and the sign-in events it is handing over, for a while: a reset
   * or confirmation link asked for just before the server stops still arrives. It stops before the providers it depends on, such as the sender's. A
   * boot that stopped before making its service sent nothing.
   */
  async shutdown(_dependencies, { outputs }) {
    const deliveries = deliveriesByService.get(outputs.authService);
    if (deliveries) {
      await deliveries.settled({ timeoutMs: DELIVERY_SHUTDOWN_WAIT_MS });
    }
  }
});

export { AuthLocalProvider };
