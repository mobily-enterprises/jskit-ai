import fastifyCookie from "@fastify/cookie";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import fastifyRateLimit from "@fastify/rate-limit";
import { safeRequestUrl } from "@jskit-ai/kernel/server/runtime/requestUrl";

import { assertAuthPolicyDeps, normalizeActorResolution } from "./authPolicySupport.js";
import { AUTH_POLICY_DENY_REASONS, createAuthPolicyError } from "./errors.js";
import { AUTH_POLICIES, resolveAuthPolicyMeta, WORKSPACE_POLICIES } from "./routeMeta.js";

const DEFAULT_API_PREFIX = "/api/";
const DEFAULT_RATE_LIMIT_PLUGIN_OPTIONS = Object.freeze({
  global: false
});
const DEFAULT_UNSAFE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeUnsafeMethods(methodsValue) {
  const source = Array.isArray(methodsValue) ? methodsValue : DEFAULT_UNSAFE_METHODS;
  return new Set(source.map((method) => String(method || "").trim().toUpperCase()).filter(Boolean));
}

function normalizeApiPrefix(value) {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_API_PREFIX;
}

function normalizeRateLimitPluginOptions(value) {
  if (!value || typeof value !== "object") {
    return {
      ...DEFAULT_RATE_LIMIT_PLUGIN_OPTIONS
    };
  }

  return value;
}

function resolveRouteConfig(request) {
  if (!request?.routeOptions || typeof request.routeOptions !== "object") {
    return {};
  }

  const routeConfig = request.routeOptions.config;
  if (!routeConfig || typeof routeConfig !== "object") {
    return {};
  }

  return routeConfig;
}

function enforceCsrfProtection(fastify, request, reply) {
  return new Promise((resolve, reject) => {
    fastify.csrfProtection(request, reply, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function resolveCsrfToken(request) {
  return request.headers["csrf-token"] || request.headers["x-csrf-token"] || request.headers["x-xsrf-token"] || null;
}

function resolveOwnerValue(meta, request) {
  if (typeof meta.ownerResolver === "function") {
    return meta.ownerResolver({
      req: request,
      res: request.raw,
      url: safeRequestUrl(request),
      params: request.params || {},
      user: request.user || null
    });
  }

  if (typeof meta.ownerParam === "string" && meta.ownerParam) {
    return request.params ? request.params[meta.ownerParam] : null;
  }

  return null;
}

function notifyPolicyDenied(onPolicyDenied, payload) {
  if (typeof onPolicyDenied !== "function") {
    return;
  }
  onPolicyDenied(payload);
}

function authPolicyPlugin(deps = {}, options = {}) {
  const { resolveActor, resolveContext, hasPermission, onPolicyDenied } = assertAuthPolicyDeps(deps);
  const apiPrefix = normalizeApiPrefix(options.apiPrefix);
  const unsafeMethods = normalizeUnsafeMethods(options.unsafeMethods);
  const rateLimitPluginOptions = normalizeRateLimitPluginOptions(options.rateLimitPluginOptions);
  const nodeEnv = String(options.nodeEnv || "").trim();
  const csrfCookieOpts =
    options.csrfCookieOpts && typeof options.csrfCookieOpts === "object" ? options.csrfCookieOpts : {};
  const resolveCsrfTokenFn = typeof options.resolveCsrfToken === "function" ? options.resolveCsrfToken : resolveCsrfToken;
  const createError =
    typeof options.createError === "function"
      ? options.createError
      : (status, message) => createAuthPolicyError(status, message);

  return async function registerAuthPolicyPlugin(fastify) {
    await fastify.register(fastifyCookie);
    await fastify.register(fastifyRateLimit, rateLimitPluginOptions);
    await fastify.register(fastifyCsrfProtection, {
      getToken: resolveCsrfTokenFn,
      cookieOpts: {
        path: "/",
        sameSite: "lax",
        secure: nodeEnv === "production",
        httpOnly: true,
        ...csrfCookieOpts
      }
    });

    fastify.decorateRequest("user", null);
    fastify.decorateRequest("workspace", null);
    fastify.decorateRequest("membership", null);
    fastify.decorateRequest("permissions", null);

    fastify.addHook("preHandler", async (request, reply) => {
      const pathname = request?.raw?.url || request?.url || "/";
      if (!String(pathname).startsWith(apiPrefix)) {
        return;
      }

      const meta = resolveAuthPolicyMeta(resolveRouteConfig(request));
      if (meta.csrfProtection && unsafeMethods.has(String(request?.method || "").toUpperCase())) {
        await enforceCsrfProtection(fastify, request, reply);
      }

      if (meta.authPolicy === AUTH_POLICIES.PUBLIC) {
        return;
      }

      const actorResolution = normalizeActorResolution(await resolveActor(request, reply, meta));
      if (actorResolution.transientFailure) {
        notifyPolicyDenied(onPolicyDenied, {
          reason: AUTH_POLICY_DENY_REASONS.AUTH_UPSTREAM_UNAVAILABLE,
          statusCode: 503,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(503, "Authentication service temporarily unavailable. Please retry.");
      }

      if (!actorResolution.authenticated) {
        notifyPolicyDenied(onPolicyDenied, {
          reason: AUTH_POLICY_DENY_REASONS.UNAUTHENTICATED,
          statusCode: 401,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(401, "Authentication required.");
      }

      request.user = actorResolution.actor;
      request.workspace = null;
      request.membership = null;
      request.permissions = [];

      if (meta.authPolicy === AUTH_POLICIES.OWN) {
        const ownerValue = await resolveOwnerValue(meta, request);
        const userValue = request?.user ? request.user[meta.userField] : null;

        if (ownerValue == null || userValue == null) {
          notifyPolicyDenied(onPolicyDenied, {
            reason: AUTH_POLICY_DENY_REASONS.OWNER_UNRESOLVED,
            statusCode: 400,
            request,
            meta,
            actor: actorResolution.actor,
            context: null
          });
          throw createError(400, "Route owner could not be resolved.");
        }

        if (String(ownerValue) !== String(userValue)) {
          notifyPolicyDenied(onPolicyDenied, {
            reason: AUTH_POLICY_DENY_REASONS.FORBIDDEN_OWNER_MISMATCH,
            statusCode: 403,
            request,
            meta,
            actor: actorResolution.actor,
            context: null
          });
          throw createError(403, "Forbidden.");
        }
      } else if (meta.authPolicy !== AUTH_POLICIES.REQUIRED) {
        notifyPolicyDenied(onPolicyDenied, {
          reason: AUTH_POLICY_DENY_REASONS.INVALID_AUTH_POLICY,
          statusCode: 500,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(500, "Invalid route auth policy configuration.");
      }

      let context = null;
      if (resolveContext && (meta.workspacePolicy !== WORKSPACE_POLICIES.NONE || meta.permission)) {
        context = await resolveContext({
          request,
          actor: actorResolution.actor,
          meta
        });
        const normalizedContext = context && typeof context === "object" ? context : {};
        request.workspace = normalizedContext.workspace || null;
        request.membership = normalizedContext.membership || null;
        request.permissions = Array.isArray(normalizedContext.permissions) ? normalizedContext.permissions : [];
      }

      if (meta.permission) {
        const allowed = await Promise.resolve(
          hasPermission({
            permission: meta.permission,
            permissions: request.permissions,
            request,
            actor: actorResolution.actor,
            context,
            meta
          })
        );
        if (!allowed) {
          notifyPolicyDenied(onPolicyDenied, {
            reason: AUTH_POLICY_DENY_REASONS.FORBIDDEN_PERMISSION,
            statusCode: 403,
            request,
            meta,
            actor: actorResolution.actor,
            context
          });
          throw createError(403, "Forbidden.");
        }
      }
    });
  };
}

export { authPolicyPlugin };
