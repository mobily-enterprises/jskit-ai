import {
  attachDeferredAuthService,
  createDeferredAuthService
} from "@jskit-ai/auth-core/server/deferredAuthService";
import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createBackchannelLogout } from "../lib/backchannelLogout.js";
import { resolveOidcConfig } from "../lib/config.js";
import { createIssuerClient } from "../lib/issuer.js";
import { registerOidcRoutes } from "../lib/routes.js";
import { createOidcAuthService } from "../lib/service.js";
import { createOidcStore } from "../lib/store.js";

const AuthOidcProvider = defineProvider({
  id: "auth.oidc",
  requires: {
    appRoot: "runtime.app-root",
    database: "runtime.database",
    env: "runtime.env",
    extensions: "auth.extensions",
    fastify: "runtime.fastify",
    logger: "runtime.logger"
  },
  optional: {
    profileProjector: "auth.profile.projector"
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
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} dependencies.database
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
   * @param {import("@jskit-ai/auth-core/server/types").AuthExtensions} dependencies.extensions
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} dependencies.fastify
   * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
   * @param {import("@jskit-ai/auth-core/server/types").AuthProfileProjector | null} dependencies.profileProjector The `auth.profile.projector`, when one is installed.
   */
  async boot({ appRoot, database, env, extensions, fastify, logger, profileProjector }, { outputs }) {
    const config = resolveOidcConfig({ env, appRoot });
    const store = createOidcStore({ knex: database.knex });
    const issuer = createIssuerClient({ config, store, logger });
    const baseService = createOidcAuthService({
      config,
      store,
      issuer,
      profileProjector,
      logger
    });
    // readable-check: allow setter-seam - deferred until boot: auth.service is built after every setup has registered its auth extensions, and those setups already receive it
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
    await registerOidcRoutes(fastify, {
      authService: baseService,
      backchannelLogout: createBackchannelLogout({ config, store, issuer })
    });
    if (config.appPublicOrigin && !config.setupProblem) {
      // Registering early lets the hub's owner approve this address before anyone signs in.
      issuer.clientFor(config.appPublicOrigin, { appName: config.appName }).catch((error) => {
        logger.info({ reason: error?.message }, "OIDC client is not ready yet; sign-in will retry.");
      });
    }
  }
});

export { AuthOidcProvider };
