import { KERNEL_TOKENS } from "@jskit-ai/kernel/shared/support/tokens";
import { registerActionContextContributor } from "@jskit-ai/kernel/server/actions";
import { authPolicyPlugin } from "../lib/plugin.js";
import { createAuthActionContextContributor } from "../lib/actionContextContributor.js";

const AUTH_ACTION_CONTEXT_CONTRIBUTOR_TOKEN = "auth.policy.actionContextContributor";

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

    const plugin = authPolicyPlugin(
      {
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
        hasPermission: defaultHasPermission
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

    await plugin(fastify);
  }
}

export { FastifyAuthPolicyServiceProvider };
