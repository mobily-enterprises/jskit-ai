import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { sideEffectsAreLive } from "@jskit-ai/kernel/shared/support/sideEffects";
import { resolveLocalAuthConfig } from "../lib/config.js";
import { createLoggedConfirmationSender, createSimulatedConfirmationSender } from "../lib/emailConfirmation.js";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { createFirstAccountSetup } from "../lib/firstAccountSetup.js";
import { createLoggedRecoverySender, createSimulatedRecoverySender } from "../lib/passwordFlows.js";
import { scryptPasswordStrategy } from "../lib/passwords.js";
import { createLocalAuthService } from "../lib/service.js";

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
    confirmationSender: "auth.local.confirmation-sender",
    passwordStrategy: "auth.local.password-strategy",
    profileProjector: "auth.profile.projector",
    recoverySender: "auth.local.recovery-sender"
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
   * @param {import("../types.js").AuthLocalConfirmationSender | null} dependencies.confirmationSender The
   *   `auth.local.confirmation-sender`, when one is installed.
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   * @param {import("../types.js").AuthLocalPasswordStrategy | null} dependencies.passwordStrategy The `auth.local.password-strategy`, when one is installed.
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The `auth.profile.projector`, when one is installed.
   * @param {import("../types.js").AuthLocalRecoverySender | null} dependencies.recoverySender The `auth.local.recovery-sender`, when one is installed.
   */
  async boot(
    { appRoot, backend, confirmationSender, env, extensions, logger, passwordStrategy, profileProjector, recoverySender },
    { outputs }
  ) {
    const fileBackend = backend === null;
    const emailRecovery = recoverySender !== null;
    const emailConfirmationSender = confirmationSender !== null;
    const config = resolveLocalAuthConfig({ appRoot, env, fileBackend, emailRecovery, emailConfirmationSender });
    const localBackend = fileBackend ? createLocalFileBackend({ storeDir: config.storeDir }) : backend;
    // A production server without accounts logs its setup code as it starts.
    const firstAccountSetup = createFirstAccountSetup({ backend: localBackend, config, logger });
    await firstAccountSetup.start();
    // A test copy (SIDE_EFFECTS is not live) logs the emails an installed sender would send, and sends none.
    const live = sideEffectsAreLive(env);
    const baseService = createLocalAuthService({
      backend: localBackend,
      config,
      confirmationSender: emailConfirmationSender
        ? (live ? confirmationSender : createSimulatedConfirmationSender(logger))
        : createLoggedConfirmationSender(logger),
      firstAccountSetup,
      invitationContextResolver: extensions.resolveInvitationContextResolver(),
      logger,
      passwordStrategy: passwordStrategy ?? scryptPasswordStrategy,
      profileProjector: profileProjector ?? noAppProfiles,
      recoverySender: emailRecovery
        ? (live ? recoverySender : createSimulatedRecoverySender(logger))
        : createLoggedRecoverySender(logger)
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthLocalProvider };
