import { defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { parseBooleanFlag } from "../booleanFlag.js";
import { authPolicyPlugin } from "../lib/plugin.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";
import { createAuthRouteVisibilityResolver } from "../lib/routeVisibilityResolver.js";

function parseList(value) {
  return String(value || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

function defaultHasPermission({ permission, permissions = [] } = {}) {
  return !permission || (Array.isArray(permissions) && permissions.includes(permission));
}

function createPolicy({ authService, extensions, env }) {
  const unsafeMethods = parseList(env.AUTH_CSRF_UNSAFE_METHODS);
  return Object.freeze({
    async resolveActor(request) {
      if (authService && typeof authService.authenticateRequest === "function") {
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

const AuthPolicyProvider = defineProvider({
  id: "auth.policy",
  requires: {
    actions: "runtime.actions",
    extensions: "auth.extensions",
    fastify: "runtime.fastify",
    http: "runtime.http",
    env: "runtime.env"
  },
  optional: {
    authService: "auth.service"
  },
  provides: {
    policy: "auth.policy"
  },
  setup({ actions, authService, extensions, http, env }) {
    const actionContext = createAuthActionContextContributor();
    actions.registerContextContributor({
      id: actionContext.contributorId,
      contribute: actionContext.contribute
    });
    const visibility = createAuthRouteVisibilityResolver();
    http.registerVisibilityResolver({
      id: visibility.resolverId,
      resolve: visibility.resolve
    });
    return { policy: createPolicy({ authService, extensions, env }) };
  },
  async boot({ fastify }, { outputs }) {
    const policy = outputs.policy;
    await authPolicyPlugin(
      {
        resolveActor: policy.resolveActor,
        resolveContext: policy.resolveContext,
        hasPermission: policy.hasPermission
      },
      policy.options
    )(fastify);
  }
});

export { AuthPolicyProvider };
