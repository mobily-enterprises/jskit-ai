import fp from "fastify-plugin";
import fastifyCookie from "@fastify/cookie";
import fastifyCsrfProtection from "@fastify/csrf-protection";
import fastifyRateLimit from "@fastify/rate-limit";
import { AppError } from "../lib/errors.js";
import { safeRequestUrl } from "../lib/requestUrl.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resolveOwnerValue(routeConfig, request) {
  if (typeof routeConfig.ownerResolver === "function") {
    return routeConfig.ownerResolver({
      req: request,
      res: request.raw,
      url: safeRequestUrl(request),
      params: request.params || {},
      user: request.user || null
    });
  }

  if (typeof routeConfig.ownerParam === "string" && routeConfig.ownerParam) {
    return request.params ? request.params[routeConfig.ownerParam] : null;
  }

  return null;
}

async function authPlugin(fastify, options) {
  const authService = options.authService;
  if (!authService) {
    throw new Error("authService is required.");
  }

  await fastify.register(fastifyCookie);
  await fastify.register(fastifyRateLimit, {
    global: false
  });
  await fastify.register(fastifyCsrfProtection, {
    getToken(request) {
      return (
        request.headers["csrf-token"] || request.headers["x-csrf-token"] || request.headers["x-xsrf-token"] || null
      );
    },
    cookieOpts: {
      path: "/",
      sameSite: "lax",
      secure: options.nodeEnv === "production",
      httpOnly: true
    }
  });

  fastify.decorateRequest("user", null);

  function enforceCsrfProtection(request, reply) {
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

  fastify.addHook("preHandler", async (request, reply) => {
    const pathname = request.raw.url || request.url || "/";
    if (!pathname.startsWith("/api/")) {
      return;
    }

    const routeConfig = request.routeOptions && request.routeOptions.config ? request.routeOptions.config : {};
    const authPolicy = routeConfig.authPolicy || "public";
    const csrfProtectionEnabled = routeConfig.csrfProtection !== false;

    if (csrfProtectionEnabled && UNSAFE_METHODS.has(request.method)) {
      await enforceCsrfProtection(request, reply);
    }

    if (authPolicy === "public") {
      return;
    }

    const authResult = await authService.authenticateRequest(request);
    if (authResult.clearSession) {
      authService.clearSessionCookies(reply);
    }
    if (authResult.session) {
      authService.writeSessionCookies(reply, authResult.session);
    }

    if (authResult.transientFailure) {
      throw new AppError(503, "Authentication service temporarily unavailable. Please retry.");
    }

    if (!authResult.authenticated) {
      throw new AppError(401, "Authentication required.");
    }

    request.user = authResult.profile;

    if (authPolicy === "required") {
      return;
    }

    if (authPolicy === "own") {
      const ownerValue = await resolveOwnerValue(routeConfig, request);
      const userField = routeConfig.userField || "id";
      const userValue = request.user ? request.user[userField] : null;

      if (ownerValue == null || userValue == null) {
        throw new AppError(400, "Route owner could not be resolved.");
      }

      if (String(ownerValue) !== String(userValue)) {
        throw new AppError(403, "Forbidden.");
      }
      return;
    }

    throw new AppError(500, "Invalid route auth policy configuration.");
  });
}

export default fp(authPlugin);
