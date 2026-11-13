import { isDevAuthBootstrapEnabled, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { resolvePassSignInFromEnv } from "@jskit-ai/auth-core/server/passSignIn";
import { resolveAuthRateLimits } from "./authRateLimits.js";
import { AuthController } from "./controllers/AuthController.js";
import { buildRoutes } from "./routes/authRoutes.js";
import { AuthWebService } from "./services/AuthWebService.js";

/**
 * The auth web routes over the installed auth service: their service,
 * controller and route table, every auth route's rate limit, and whether
 * one-time pass sign-in is on. Routes are registered at setup, before the
 * deferred auth service exists, so dev login-as and pass sign-in are read from
 * the env with the predicates the auth providers use.
 * @param {object} dependencies
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeConfig} dependencies.config
 */
function createAuthWeb({ authService, env, config }) {
  const service = new AuthWebService({
    authService,
    devAuthBootstrapEnabled: isDevAuthBootstrapEnabled(resolveDevAuthPolicyFromEnv(env))
  });
  const controller = new AuthController({ service });
  const rateLimits = resolveAuthRateLimits(config);
  const routes = buildRoutes(controller, {
    includeDevLoginAs: service.isDevLoginAsAvailable(),
    rateLimits
  });
  return Object.freeze({
    controller,
    routes: Object.freeze(routes),
    service,
    rateLimits,
    // AUTH_PASS_PUBLIC_KEY is set: POST /api/login/pass takes one-time signed passes.
    passSignIn: resolvePassSignInFromEnv(env) !== null
  });
}

export { createAuthWeb };
