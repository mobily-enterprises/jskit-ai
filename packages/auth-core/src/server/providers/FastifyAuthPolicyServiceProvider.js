import { registerActionContextContributor } from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import {
  resolveComposedAuthPolicyContextResolver
} from "../authPolicyContextResolverRegistry.js";
import { parseBooleanFlag } from "../booleanFlag.js";
import { authPolicyPlugin } from "../lib/plugin.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";
import { createAuthRouteVisibilityResolver } from "../lib/routeVisibilityResolver.js";

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
    const env = app.has("jskit.env") ? app.make("jskit.env") : {};
    const fastify = app.make("jskit.fastify");

    const pluginDeps = {
      resolveActor: async (request) => {
        if (!app.has("authService")) {
          return {
            authenticated: false,
            actor: null,
            transientFailure: false
          };
        }
        const authService = app.make("authService");
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
      resolveContext: async (input = {}) => {
        const resolveContext = resolveComposedAuthPolicyContextResolver(app);

        if (typeof resolveContext !== "function") {
          return null;
        }

        return resolveContext(input);
      }
    };

    const plugin = authPolicyPlugin(
      pluginDeps,
      {
        nodeEnv: String(env.NODE_ENV || "development").trim() || "development",
        apiPrefix: String(env.AUTH_API_PREFIX || "/api/").trim() || "/api/",
        unsafeMethods: parseList(env.AUTH_CSRF_UNSAFE_METHODS),
        csrfCookieOpts: {
          secure: parseBooleanFlag(env.AUTH_CSRF_COOKIE_SECURE, false)
        }
      }
    );

    await plugin(fastify);
  }
}

export { FastifyAuthPolicyServiceProvider };
