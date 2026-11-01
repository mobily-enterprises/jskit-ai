import { parseBooleanFlag } from "./booleanFlag.js";

function parseList(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function defaultHasPermission({ permission, permissions }) {
  return !permission || (Array.isArray(permissions) && permissions.includes(permission));
}

/** The authentication an application without an `auth.service` has: every request is signed out. */
const everyoneSignedOut = Object.freeze({
  async authenticateRequest() {
    return { authenticated: false, actor: null, transientFailure: false };
  }
});

/**
 * How the auth policy plugin resolves a request's actor, permissions and policy context.
 * @param {object} dependencies
 * @param {Pick<import("./types.js").AuthService, "authenticateRequest">} dependencies.authService The installed
 *   provider's `auth.service`, or everyoneSignedOut.
 * @param {import("./types.js").AuthExtensions} dependencies.extensions
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 */
function createAuthPolicy({ authService, extensions, env }) {
  const unsafeMethods = parseList(env.AUTH_CSRF_UNSAFE_METHODS);
  return Object.freeze({
    resolveActor(request) {
      return authService.authenticateRequest(request);
    },
    hasPermission: defaultHasPermission,
    resolveContext(input) {
      return extensions.resolvePolicyContext(input);
    },
    options: Object.freeze({
      // The plugin resolves both defaults: NODE_ENV not production, and the /api/ prefix.
      nodeEnv: env.NODE_ENV,
      apiPrefix: env.AUTH_API_PREFIX,
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

export { createAuthPolicy, everyoneSignedOut };
