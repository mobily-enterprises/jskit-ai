import { parseBooleanFlag } from "./booleanFlag.js";

function parseList(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function defaultHasPermission({ permission, permissions = [] } = {}) {
  return !permission || (Array.isArray(permissions) && permissions.includes(permission));
}

// How the auth policy plugin resolves a request's actor, permissions and policy context.
/**
 * @param {object} dependencies
 * @param {import("./types.js").AuthService | null} dependencies.authService The installed provider's `auth.service`, when there is one.
 * @param {import("./types.js").AuthExtensions} dependencies.extensions
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
function createAuthPolicy({ authService, extensions, env }) {
  const unsafeMethods = parseList(env.AUTH_CSRF_UNSAFE_METHODS);
  return Object.freeze({
    async resolveActor(request) {
      if (authService) {
        return authService.authenticateRequest(request);
      }
      return { authenticated: false, actor: null, transientFailure: false };
    },
    hasPermission: defaultHasPermission,
    resolveContext(input = {}) {
      return extensions.resolvePolicyContext(input);
    },
    options: Object.freeze({
      nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
      apiPrefix: String(env.AUTH_API_PREFIX || "/api/").trim() || "/api/",
      // Unset AUTH_CSRF_UNSAFE_METHODS keeps the plugin default (POST, PUT, PATCH, DELETE).
      unsafeMethods: unsafeMethods.length > 0 ? Object.freeze(unsafeMethods) : undefined,
      // Unset AUTH_CSRF_COOKIE_SECURE follows NODE_ENV (Secure in production).
      csrfCookieOpts: Object.freeze(
        String(env.AUTH_CSRF_COOKIE_SECURE ?? "").trim()
          ? { secure: parseBooleanFlag(env.AUTH_CSRF_COOKIE_SECURE, false) }
          : {}
      )
    })
  });
}

export { createAuthPolicy };
