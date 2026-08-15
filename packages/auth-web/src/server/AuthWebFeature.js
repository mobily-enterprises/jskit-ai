import { resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { AuthController } from "./controllers/AuthController.js";
import { buildRoutes } from "./routes/authRoutes.js";
import { AuthWebService } from "./services/AuthWebService.js";

function devAuthBootstrapEnabled(env) {
  const policy = resolveDevAuthPolicyFromEnv(env);
  return policy.enabled && !policy.isProduction;
}

const AuthWebFeature = defineFeature({
  id: "auth.web",
  domain: "auth",
  requires: {
    authService: "auth.service",
    env: "runtime.env",
    http: "runtime.http"
  },
  provides: {
    authWeb: "auth.web"
  },
  setup({ authService, env, http }) {
    const service = new AuthWebService({
      authService,
      devAuthBootstrapEnabled: devAuthBootstrapEnabled(env)
    });
    const controller = new AuthController({ service });
    const routes = buildRoutes(controller, {
      includeDevLoginAs: service.isDevLoginAsAvailable()
    });
    for (const route of routes) {
      http.router.register(route.method, route.path, route, route.handler);
    }
    return {
      authWeb: Object.freeze({ controller, routes: Object.freeze(routes), service })
    };
  }
});

export { AuthWebFeature };
