import { resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { AuthController } from "./controllers/AuthController.js";
import { buildRoutes } from "./routes/authRoutes.js";
import { AuthWebService } from "./services/AuthWebService.js";

function devAuthBootstrapEnabled(env) {
  const policy = resolveDevAuthPolicyFromEnv(env);
  return policy.enabled && !policy.isProduction;
}

/**
 * The auth web routes over the installed auth service: their service,
 * controller and route table.
 * @param {object} dependencies
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
function createAuthWeb({ authService, env }) {
  const service = new AuthWebService({
    authService,
    devAuthBootstrapEnabled: devAuthBootstrapEnabled(env)
  });
  const controller = new AuthController({ service });
  const routes = buildRoutes(controller, {
    includeDevLoginAs: service.isDevLoginAsAvailable()
  });
  return Object.freeze({ controller, routes: Object.freeze(routes), service });
}

export { createAuthWeb };
