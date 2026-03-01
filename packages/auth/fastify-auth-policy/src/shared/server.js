import { authPolicyPlugin } from "./plugin.js";

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function defaultHasPermission({ permission, permissions = [] } = {}) {
  if (!permission) {
    return true;
  }
  return Array.isArray(permissions) ? permissions.includes(permission) : false;
}

function createServerContributions() {
  return {
    repositories: [],
    services: [],
    controllers: [],
    routes: [],
    actions: [],
    plugins: [
      {
        id: "auth-policy",
        create({ services = {}, dependencies = {} } = {}) {
          const envFromDependencies =
            dependencies?.env && typeof dependencies.env === "object" ? dependencies.env : {};
          const env = {
            ...process.env,
            ...envFromDependencies
          };
          const resolveActor =
            typeof dependencies.resolveActor === "function"
              ? dependencies.resolveActor
              : async (request) => {
                  if (
                    services.authService &&
                    typeof services.authService.authenticateRequest === "function"
                  ) {
                    return services.authService.authenticateRequest(request);
                  }
                  return {
                    authenticated: false,
                    actor: null,
                    transientFailure: false
                  };
                };

          const hasPermission =
            typeof dependencies.hasPermission === "function" ? dependencies.hasPermission : defaultHasPermission;
          const resolveContext =
            typeof dependencies.resolveContext === "function" ? dependencies.resolveContext : undefined;
          const onPolicyDenied =
            typeof dependencies.onPolicyDenied === "function" ? dependencies.onPolicyDenied : undefined;

          const plugin = authPolicyPlugin(
            {
              resolveActor,
              hasPermission,
              ...(resolveContext ? { resolveContext } : {}),
              ...(onPolicyDenied ? { onPolicyDenied } : {})
            },
            {
              nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
              apiPrefix: String(env.AUTH_API_PREFIX || "/api/").trim() || "/api/",
              unsafeMethods: parseList(env.AUTH_CSRF_UNSAFE_METHODS),
              csrfCookieOpts: {
                secure: parseBoolean(env.AUTH_CSRF_COOKIE_SECURE, false)
              }
            }
          );

          return {
            async register(app) {
              await plugin(app);
            }
          };
        }
      }
    ],
    workers: [],
    lifecycle: []
  };
}

export { createServerContributions };
