import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionContextContributor } from "@jskit-ai/kernel/server/actions";
import { registerRouteVisibilityResolver } from "@jskit-ai/kernel/server/http";
import { authPolicyPlugin } from "../lib/plugin.js";
import { AUTH_POLICY_CONTEXT_RESOLVER_TOKEN } from "../lib/tokens.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";
import { createAuthRouteVisibilityResolver } from "../lib/routeVisibilityResolver.js";

const AUTH_ACTION_CONTEXT_CONTRIBUTOR_TOKEN = "auth.policy.actionContextContributor";
const AUTH_ROUTE_VISIBILITY_RESOLVER_TOKEN = "auth.policy.routeVisibilityResolver";

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
      !app.has(AUTH_ACTION_CONTEXT_CONTRIBUTOR_TOKEN) &&
      typeof app.singleton === "function" &&
      typeof app.tag === "function"
    ) {
      registerActionContextContributor(app, AUTH_ACTION_CONTEXT_CONTRIBUTOR_TOKEN, () =>
        createAuthActionContextContributor()
      );
    }

    if (
      !app.has(AUTH_ROUTE_VISIBILITY_RESOLVER_TOKEN) &&
      typeof app.singleton === "function" &&
      typeof app.tag === "function"
    ) {
      registerRouteVisibilityResolver(app, AUTH_ROUTE_VISIBILITY_RESOLVER_TOKEN, () =>
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

    const env = app.has(KERNEL_TOKENS.Env) ? app.make(KERNEL_TOKENS.Env) : {};
    const fastify = app.make(KERNEL_TOKENS.Fastify);
    const authService = app.make("authService");
    const resolveContext =
      typeof app.has === "function" && app.has(AUTH_POLICY_CONTEXT_RESOLVER_TOKEN)
        ? app.make(AUTH_POLICY_CONTEXT_RESOLVER_TOKEN)
        : null;

    if (resolveContext != null && typeof resolveContext !== "function") {
      throw new Error(
        `FastifyAuthPolicyServiceProvider requires ${AUTH_POLICY_CONTEXT_RESOLVER_TOKEN} to be a function when provided.`
      );
    }

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
