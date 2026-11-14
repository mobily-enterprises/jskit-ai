import fastifyCookie from "@fastify/cookie";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import { safeRequestUrl } from "@jskit-ai/kernel/server/runtime/requestUrl";
import { isDeployed } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { SECOND_FACTOR_REQUIRED } from "../../shared/authSecondFactor.js";
import { isSecondFactorMet, secondFactorRequiredParams } from "../secondFactor.js";
import { hostOnlyCookieName } from "../utils.js";

import { assertAuthPolicyDeps, normalizeActorResolution } from "./authPolicySupport.js";
import { AUTH_POLICY_DENY_REASONS, createAuthPolicyError } from "./errors.js";
import { AUTH_POLICIES, CONTEXT_POLICIES, resolveAuthPolicyMeta } from "./routeMeta.js";

const DEFAULT_API_PREFIX = "/api/";
const DEFAULT_UNSAFE_METHODS = Object.freeze(["POST", "PUT", "PATCH", "DELETE"]);

function normalizeUnsafeMethods(methodsValue) {
  const source = Array.isArray(methodsValue) ? methodsValue : DEFAULT_UNSAFE_METHODS;
  return new Set(source.map((method) => String(method || "").trim().toUpperCase()).filter(Boolean));
}

function normalizeApiPrefix(value) {
  const normalized = String(value || "").trim();
  return normalized || DEFAULT_API_PREFIX;
}

function resolveRouteConfig(request) {
  if (!request.routeOptions || typeof request.routeOptions !== "object") {
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
  // readable-check: allow method-probe - data: a route's auth policy config may name an owner resolver
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

function authPolicyPlugin(deps = {}, options = {}) {
  const { resolveActor, resolveContext, hasPermission, onPolicyDenied } = assertAuthPolicyDeps(deps);
  const apiPrefix = normalizeApiPrefix(options.apiPrefix);
  const unsafeMethods = normalizeUnsafeMethods(options.unsafeMethods);
  const csrfCookieOpts =
    options.csrfCookieOpts && typeof options.csrfCookieOpts === "object" ? options.csrfCookieOpts : {};
  // createError(status, englishMessage, { code }) builds each refusal.
  const { resolveCsrfToken: resolveCsrfTokenFn = resolveCsrfToken, createError = createAuthPolicyError } = options;

  // CSRF uses tokens checked against a secret cookie, never SameSite alone. In
  // staging and production (APP_ENV) that cookie is host-only (__Host-), so a sibling host cannot plant
  // a secret it knows and forge tokens.
  const csrfCookieSecure = typeof csrfCookieOpts.secure === "boolean" ? csrfCookieOpts.secure : isDeployed({ APP_ENV: options.appEnv });
  const csrfCookieOptions = {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    ...csrfCookieOpts,
    secure: csrfCookieSecure
  };
  const csrfCookieHostOnly = csrfCookieSecure && csrfCookieOptions.path === "/" && !csrfCookieOptions.domain;

  return async function registerAuthPolicyPlugin(fastify) {
    await fastify.register(fastifyCookie);
    await fastify.register(fastifyCsrfProtection, {
      getToken: resolveCsrfTokenFn,
      cookieKey: hostOnlyCookieName("_csrf", csrfCookieHostOnly),
      cookieOpts: csrfCookieOptions
    });

    fastify.decorateRequest("user", null);
    fastify.decorateRequest("workspace", null);
    fastify.decorateRequest("membership", null);
    fastify.decorateRequest("permissions", null);
    fastify.decorateRequest("secondFactorAt", "");

    fastify.addHook("preHandler", async (request, reply) => {
      const pathname = request.raw.url || request.url || "/";
      if (!String(pathname).startsWith(apiPrefix)) {
        return;
      }

      const meta = resolveAuthPolicyMeta(resolveRouteConfig(request));
      if (meta.csrfProtection && unsafeMethods.has(String(request.method || "").toUpperCase())) {
        await enforceCsrfProtection(fastify, request, reply);
      }

      if (meta.authPolicy === AUTH_POLICIES.PUBLIC) {
        return;
      }

      const actorResolution = normalizeActorResolution(await resolveActor(request, reply, meta));
      if (actorResolution.transientFailure) {
        onPolicyDenied({
          reason: AUTH_POLICY_DENY_REASONS.AUTH_UPSTREAM_UNAVAILABLE,
          statusCode: 503,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(503, "Authentication service temporarily unavailable. Please retry.", {
          code: "auth.session.unavailable"
        });
      }

      if (!actorResolution.authenticated) {
        onPolicyDenied({
          reason: AUTH_POLICY_DENY_REASONS.UNAUTHENTICATED,
          statusCode: 401,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(401, "Authentication required.", { code: "auth.session.required" });
      }

      request.user = actorResolution.actor;
      request.secondFactorAt = actorResolution.secondFactorAt;
      request.workspace = null;
      request.membership = null;
      request.permissions = [];

      if (meta.authPolicy === AUTH_POLICIES.OWN) {
        const ownerValue = await resolveOwnerValue(meta, request);
        const userValue = request.user ? request.user[meta.userField] : null;

        if (ownerValue == null || userValue == null) {
          onPolicyDenied({
            reason: AUTH_POLICY_DENY_REASONS.OWNER_UNRESOLVED,
            statusCode: 400,
            request,
            meta,
            actor: actorResolution.actor,
            context: null
          });
          throw createError(400, "Route owner could not be resolved.", { code: "auth.policy.ownerUnresolved" });
        }

        if (String(ownerValue) !== String(userValue)) {
          onPolicyDenied({
            reason: AUTH_POLICY_DENY_REASONS.FORBIDDEN_OWNER_MISMATCH,
            statusCode: 403,
            request,
            meta,
            actor: actorResolution.actor,
            context: null
          });
          throw createError(403, "Forbidden.", { code: "auth.policy.ownerMismatch" });
        }
      } else if (meta.authPolicy !== AUTH_POLICIES.REQUIRED) {
        onPolicyDenied({
          reason: AUTH_POLICY_DENY_REASONS.INVALID_AUTH_POLICY,
          statusCode: 500,
          request,
          meta,
          actor: actorResolution.actor,
          context: null
        });
        throw createError(500, "Invalid route auth policy configuration.", { code: "auth.policy.invalidConfiguration" });
      }

      let context = null;
      if (meta.contextPolicy !== CONTEXT_POLICIES.NONE || meta.permission) {
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
          onPolicyDenied({
            reason: AUTH_POLICY_DENY_REASONS.FORBIDDEN_PERMISSION,
            statusCode: 403,
            request,
            meta,
            actor: actorResolution.actor,
            context
          });
          throw createError(403, "Forbidden.", { code: "auth.policy.permissionDenied" });
        }
      }

      if (meta.secondFactor && !isSecondFactorMet(actorResolution.secondFactorAt, meta.secondFactor, Date.now())) {
        onPolicyDenied({
          reason: AUTH_POLICY_DENY_REASONS.SECOND_FACTOR_REQUIRED,
          statusCode: 403,
          request,
          meta,
          actor: actorResolution.actor,
          context
        });
        throw createError(403, SECOND_FACTOR_REQUIRED.message, {
          code: SECOND_FACTOR_REQUIRED.code,
          params: secondFactorRequiredParams(meta.secondFactor)
        });
      }
    });
  };
}

export { authPolicyPlugin };
