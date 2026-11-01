import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { noAppProfiles } from "@jskit-ai/auth-core/server/noAppProfiles";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { resolveLocalAuthConfig } from "../lib/config.js";
import { createLocalFileBackend } from "../lib/fileBackend.js";
import { createLoggedRecoverySender } from "../lib/passwordFlows.js";
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
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   * @param {import("../types.js").AuthLocalPasswordStrategy | null} dependencies.passwordStrategy The `auth.local.password-strategy`, when one is installed.
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The `auth.profile.projector`, when one is installed.
   * @param {import("../types.js").AuthLocalRecoverySender | null} dependencies.recoverySender The `auth.local.recovery-sender`, when one is installed.
   */
  boot({ appRoot, backend, env, extensions, logger, passwordStrategy, profileProjector, recoverySender }, { outputs }) {
    const config = resolveLocalAuthConfig({
      appRoot,
      env,
      fileBackend: backend === null,
      emailRecovery: recoverySender !== null
    });
    const baseService = createLocalAuthService({
      backend: backend ?? createLocalFileBackend({ storeDir: config.storeDir }),
      config,
      invitationContextResolver: extensions.resolveInvitationContextResolver(),
      logger,
      passwordStrategy: passwordStrategy ?? scryptPasswordStrategy,
      profileProjector: profileProjector ?? noAppProfiles,
      recoverySender: recoverySender ?? createLoggedRecoverySender(logger)
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
  }
});

export { AuthLocalProvider };
