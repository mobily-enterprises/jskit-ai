import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createAuthWeb } from "./authWeb.js";
import { registerClientAuthorizationRoutes } from "./routes/clientAuthorizationRoutes.js";
import { registerEmailChangeRoutes } from "./routes/emailChangeRoutes.js";
import { registerPassSignInRoutes } from "./routes/passSignInRoutes.js";
import { registerSecondFactorRoutes } from "./routes/secondFactorRoutes.js";

const AuthWebFeature = defineFeature({
  id: "auth.web",
  domain: "auth",
  requires: {
    authService: "auth.service",
    config: "runtime.config",
    env: "runtime.env",
    fastify: "runtime.fastify",
    http: "runtime.http"
  },
  optional: {
    appRoot: "runtime.app-root"
  },
  provides: {
    authWeb: "auth.web"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/auth-core/server/types").AuthService} capabilities.authService
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   */
  setup({ authService, config, env, http }) {
    const authWeb = createAuthWeb({ authService, env, config });
    for (const route of authWeb.routes) {
      http.router.register(route.method, route.path, route, route.handler);
    }
    registerSecondFactorRoutes(http.router, { rateLimits: authWeb.rateLimits });
    registerEmailChangeRoutes(http.router, { rateLimits: authWeb.rateLimits });
    return { authWeb };
  },
  /**
   * The pass sign-in route and the OAuth authorization server's routes take form bodies, so they have Fastify scopes of
   * their own, registered once runtime.http has started: the routes' rate limiter is registered by then, and limits
   * them too. The authorization server's routes are there only while the provider has clients (config.auth.clients).
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeAppRoot | null} capabilities.appRoot Where the app's
   *   translations of the consent page are, when there is an app root.
   * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} capabilities.config
   * @param {import("@jskit-ai/kernel/server/types").RuntimeFastify} capabilities.fastify
   * @param {{ outputs: { authWeb: import("./types.js").AuthWeb } }} lifecycle
   */
  async boot({ appRoot, config, fastify }, { outputs }) {
    const { authWeb } = outputs;
    if (authWeb.passSignIn) {
      await registerPassSignInRoutes(fastify, { service: authWeb.service, rateLimit: authWeb.rateLimits.passSignIn });
    }
    await registerClientAuthorizationRoutes(fastify, {
      service: authWeb.service,
      appName: String(config.app?.name || "").trim(),
      appRoot,
      rateLimit: authWeb.rateLimits.clientToken
    });
  }
});

export { AuthWebFeature };
