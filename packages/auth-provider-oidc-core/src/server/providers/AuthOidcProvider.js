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
  provides: {
    authService: "auth.service"
  },
  setup() {
    return { authService: createDeferredAuthService() };
  },
  async boot({ appRoot, database, env, extensions, fastify, logger }, { outputs }) {
    const config = resolveOidcConfig({ env, appRoot });
    const store = createOidcStore({ knex: database.knex });
    const issuer = createIssuerClient({ config, store, logger });
    const baseService = createOidcAuthService({
      config,
      store,
      issuer,
      profileProjector: extensions.resolveProfileProjector(),
      logger
    });
    attachDeferredAuthService(outputs.authService, extensions.decorateService(baseService));
    await registerOidcRoutes(fastify, {
      authService: baseService,
      backchannelLogout: createBackchannelLogout({ config, store, issuer })
    });
    if (config.appPublicOrigin && !config.setupProblem) {
      // Registering early lets the hub's owner approve this address before anyone signs in.
      issuer.clientFor(config.appPublicOrigin, { appName: config.appName }).catch((error) => {
        logger?.info?.({ reason: error?.message }, "OIDC client is not ready yet; sign-in will retry.");
      });
    }
  }
});

export { AuthOidcProvider };
