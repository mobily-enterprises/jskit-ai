import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { resolveLocalAuthConfig } from "../lib/config.js";
import { DELIVERY_SHUTDOWN_WAIT_MS, createLocalDeliveries } from "../lib/deliveries.js";
import {
  confirmEveryRegistrationByLink,
  createLoggedConfirmationSender,
  createSimulatedConfirmationSender
} from "../lib/emailConfirmation.js";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { createFirstAccountSetup } from "../lib/firstAccountSetup.js";
import { noPassIdentities } from "../lib/passSignIn.js";
import { createLoggedRecoverySender, createSimulatedRecoverySender } from "../lib/passwordFlows.js";
import { scryptPasswordStrategy } from "../lib/passwords.js";
import { createLoggedSecondFactorEvents } from "../lib/secondFactor.js";
import { createLocalAuthService } from "../lib/service.js";

// The emails each started auth service is still sending, by the service its setup gave out, for its shutdown.
const deliveriesByService = new WeakMap();

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
    passIdentity: "auth.local.pass-identity",
    passwordStrategy: "auth.local.password-strategy",
    profileProjector: "auth.profile.projector",
    recoverySender: "auth.local.recovery-sender",
    secondFactorEvents: "auth.local.second-factor-events"
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
   */
  async boot(
    {
      appRoot,
      backend,
      confirmationMode,
      confirmationSender,
      env,
      extensions,
      logger,
      passIdentity,
      passwordStrategy,
      profileProjector,
      recoverySender,
      secondFactorEvents
    },
    { outputs }
  ) {
    const fileBackend = backend === null;
    const emailRecovery = recoverySender !== null;
    const emailConfirmationSender = confirmationSender !== null;
    const config = resolveLocalAuthConfig({ appRoot, env, fileBackend, emailRecovery, emailConfirmationSender });
    if (config.passSignIn && passIdentity === null) {
      throw new Error("AUTH_PASS_PUBLIC_KEY turns on one-time pass sign-in, and no auth.local.pass-identity is installed to name the account each pass signs in. Install one, or unset AUTH_PASS_PUBLIC_KEY.");
    }
    const localBackend = fileBackend ? createLocalFileBackend({ storeDir: config.storeDir }) : backend;
    // A production server without accounts logs its setup code as it starts.
    const firstAccountSetup = createFirstAccountSetup({ backend: localBackend, config, logger });
    await firstAccountSetup.start();
    // A test copy (SIDE_EFFECTS is not live) logs the emails an installed sender would send, and sends none, whatever
    // the sender. The confirmation mode sends nothing, so a test copy keeps it.
    const live = sideEffectsAreLive(env);
    const deliveries = createLocalDeliveries({ logger });
    deliveriesByService.set(outputs.authService, deliveries);
    const baseService = createLocalAuthService({
      backend: localBackend,
      config,
      confirmationMode: confirmationMode ?? confirmEveryRegistrationByLink,
      confirmationSender: emailConfirmationSender
        ? (live ? confirmationSender : createSimulatedConfirmationSender(logger))
        : createLoggedConfirmationSender(logger),
      deliveries,
      firstAccountSetup,
      invitationContextResolver: extensions.resolveInvitationContextResolver(),
      logger,
      passIdentity: passIdentity ?? noPassIdentities,
      passwordStrategy: passwordStrategy ?? scryptPasswordStrategy,
      profileProjector: profileProjector ?? noAppProfiles,
      recoverySender: emailRecovery
        ? (live ? recoverySender : createSimulatedRecoverySender(logger))
        : createLoggedRecoverySender(logger),
      secondFactorEvents: secondFactorEvents ?? createLoggedSecondFactorEvents(logger)
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  },
  /**
   * Waits for the emails local auth is still sending, for a while: a reset or confirmation link asked for just
   * before the server stops still arrives. It stops before the providers it depends on, such as the sender's. A
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
