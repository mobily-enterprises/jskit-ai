import { hasPermission } from "@jskit-ai/kernel/shared/support/permissions";
import { appEnvironment } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { parseBooleanFlag } from "./booleanFlag.js";
import { resolveAuthCookieSameSite } from "./utils.js";

function parseList(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

// A route permission matches grants as action permissions do: "*", the exact name, or a grant ending in ".*".
function defaultHasPermission({ permission, permissions }) {
  return hasPermission(permissions, permission);
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
  const csrfCookieSameSite = resolveAuthCookieSameSite(env);

  function resolveActor(request) {
    return authService.authenticateRequest(request);
  }

  function resolveContext(input) {
    return extensions.resolvePolicyContext(input);
  }

  return Object.freeze({
    resolveActor,
    hasPermission: defaultHasPermission,
    resolveContext,
    options: Object.freeze({
      // The plugin resolves the /api/ prefix by default; the CSRF cookie follows APP_ENV.
      appEnv: appEnvironment(env),
      apiPrefix: env.AUTH_API_PREFIX,
      // Unset AUTH_CSRF_UNSAFE_METHODS keeps the plugin default (POST, PUT, PATCH, DELETE).
      unsafeMethods: unsafeMethods.length > 0 ? Object.freeze(unsafeMethods) : undefined,
      // The CSRF cookie's SameSite is the sign-in cookies' (AUTH_COOKIE_SAME_SITE). Unset AUTH_CSRF_COOKIE_SECURE
      // follows APP_ENV (Secure in staging and production).
      csrfCookieOpts: Object.freeze({
        sameSite: csrfCookieSameSite,
        ...(String(env.AUTH_CSRF_COOKIE_SECURE ?? "").trim()
          ? { secure: parseBooleanFlag(env.AUTH_CSRF_COOKIE_SECURE, false) }
          : {})
      })
    })
  });
}

export { createAuthPolicy, everyoneSignedOut };
