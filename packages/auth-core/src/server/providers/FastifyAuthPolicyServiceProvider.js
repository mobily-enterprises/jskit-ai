import { registerActionContextContributor } from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import {
  composeAuthPolicyContextResolvers,
  resolveAuthPolicyContextResolvers
} from "../authPolicyContextResolverRegistry.js";
import { authPolicyPlugin } from "../lib/plugin.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";
import { createAuthRouteVisibilityResolver } from "../lib/routeVisibilityResolver.js";

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

class FastifyAuthPolicyServiceProvider {
  static id = "auth.policy.fastify";

  static dependsOn = ["auth.provider"];

  register(app) {
    if (!app || typeof app.has !== "function") {
      throw new Error("FastifyAuthPolicyServiceProvider requires application has().");
    }

    if (
      !app.has("auth.policy.actionContextContributor") &&
      typeof app.singleton === "function" &&
      typeof app.tag === "function"
    ) {
      registerActionContextContributor(app, "auth.policy.actionContextContributor", () =>
        createAuthActionContextContributor()
      );
    }

    if (
      !app.has("auth.policy.routeVisibilityResolver") &&
      typeof app.singleton === "function" &&
      typeof app.tag === "function"
    ) {
      registerRouteVisibilityResolver(app, "auth.policy.routeVisibilityResolver", () =>
        createAuthRouteVisibilityResolver()
      );
    }
  }

  async boot(app) {
    if (!app || typeof app.make !== "function" || typeof app.has !== "function") {
      throw new Error("FastifyAuthPolicyServiceProvider requires application make()/has().");
    }
    if (!app.has("authService")) {
      throw new Error("FastifyAuthPolicyServiceProvider requires authService binding.");
    }

    const env = app.has("jskit.env") ? app.make("jskit.env") : {};
    const fastify = app.make("jskit.fastify");
    const authService = app.make("authService");
    const legacyResolveContext =
      typeof app.has === "function" && app.has("auth.policy.contextResolver")
        ? app.make("auth.policy.contextResolver")
        : null;

    if (legacyResolveContext != null && typeof legacyResolveContext !== "function") {
      throw new Error(
        "FastifyAuthPolicyServiceProvider requires auth.policy.contextResolver to be a function when provided."
      );
    }

    const resolveContext = composeAuthPolicyContextResolvers([
      ...resolveAuthPolicyContextResolvers(app),
      ...(legacyResolveContext
        ? [
            {
              resolverId: "legacy.auth.policy.contextResolver",
              order: 1000,
              resolveAuthPolicyContext: legacyResolveContext
            }
          ]
        : [])
    ]);

    const pluginDeps = {
      resolveActor: async (request) => {
        if (authService && typeof authService.authenticateRequest === "function") {
          return authService.authenticateRequest(request);
        }
        return {
          authenticated: false,
          actor: null,
          transientFailure: false
        };
      },
      hasPermission: defaultHasPermission,
      ...(typeof resolveContext === "function" ? { resolveContext } : {})
    };

    const plugin = authPolicyPlugin(
      pluginDeps,
      {
        nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
        apiPrefix: String(env.AUTH_API_PREFIX || "/api/").trim() || "/api/",
        unsafeMethods: parseList(env.AUTH_CSRF_UNSAFE_METHODS),
        csrfCookieOpts: {
          secure: parseBoolean(env.AUTH_CSRF_COOKIE_SECURE, false)
        }
      }
    );

    await plugin(fastify);
  }
}

export { FastifyAuthPolicyServiceProvider };
