import { defaultMissingHandler } from "./routeUtils.js";
import { normalizeRouteVisibility } from "../../shared/support/visibility.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildBaseRouteOptions(route) {
  if (!isRecord(route)) {
    throw new TypeError("Route definition must be an object.");
  }

  const sourceRoute = route;
  const routeOptions = {
    method: sourceRoute.method,
    url: sourceRoute.path,
    config: {}
  };

  if (sourceRoute.schema) {
    routeOptions.schema = sourceRoute.schema;
  }
  if (sourceRoute.bodyLimit) {
    routeOptions.bodyLimit = sourceRoute.bodyLimit;
  }
  if (sourceRoute.rateLimit) {
    routeOptions.config.rateLimit = sourceRoute.rateLimit;
  }

  return routeOptions;
}

function normalizeRoutePolicyConfig(routeOptions, route) {
  const sourceRouteOptions = isRecord(routeOptions) ? routeOptions : {};
  const sourceConfig = isRecord(sourceRouteOptions.config) ? sourceRouteOptions.config : {};
  const sourceRoute = isRecord(route) ? route : {};

  const nextConfig = {
    ...sourceConfig
  };

  if (Object.hasOwn(sourceRoute, "auth")) {
    nextConfig.authPolicy = sourceRoute.auth;
  }
  if (Object.hasOwn(sourceRoute, "contextPolicy")) {
    nextConfig.contextPolicy = sourceRoute.contextPolicy;
  }
  if (Object.hasOwn(sourceRoute, "surface")) {
    nextConfig.surface = sourceRoute.surface;
  }
  if (Object.hasOwn(sourceRoute, "visibility")) {
    nextConfig.visibility = normalizeRouteVisibility(sourceRoute.visibility);
  }
  if (Object.hasOwn(sourceRoute, "permission")) {
    nextConfig.permission = sourceRoute.permission;
  }
  if (Object.hasOwn(sourceRoute, "ownerParam")) {
    nextConfig.ownerParam = sourceRoute.ownerParam;
  }
  if (Object.hasOwn(sourceRoute, "userField")) {
    nextConfig.userField = sourceRoute.userField;
  }
  if (Object.hasOwn(sourceRoute, "ownerResolver")) {
    nextConfig.ownerResolver = sourceRoute.ownerResolver;
  }
  if (Object.hasOwn(sourceRoute, "csrfProtection")) {
    nextConfig.csrfProtection = sourceRoute.csrfProtection;
  }

  return nextConfig;
}

function defaultApplyRoutePolicy(routeOptions, route) {
  return {
    ...routeOptions,
    config: normalizeRoutePolicyConfig(routeOptions, route)
  };
}

function registerApiRouteDefinitions(
  fastify,
  { routes = [], applyRoutePolicy = defaultApplyRoutePolicy, resolveRequestUrl = null, missingHandler } = {}
) {
  if (!fastify || typeof fastify.route !== "function") {
    throw new TypeError("registerApiRouteDefinitions requires a Fastify instance.");
  }

  const routeList = Array.isArray(routes) ? routes : [];
  const toRequestUrl = typeof resolveRequestUrl === "function" ? resolveRequestUrl : () => null;
  const routePolicyApplier = typeof applyRoutePolicy === "function" ? applyRoutePolicy : defaultApplyRoutePolicy;
  const fallbackHandler = typeof missingHandler === "function" ? missingHandler : defaultMissingHandler;

  for (const route of routeList) {
    const routeOptions = routePolicyApplier(buildBaseRouteOptions(route), route);
    let routeHandler = fallbackHandler;
    if (isRecord(route) && typeof route.handler === "function") {
      routeHandler = route.handler;
    }
    fastify.route({
      ...routeOptions,
      handler: async (request, reply) => {
        await routeHandler(request, reply, toRequestUrl(request));
      }
    });
  }
}

const __testables = {
  buildBaseRouteOptions,
  defaultApplyRoutePolicy,
  normalizeRoutePolicyConfig,
  defaultMissingHandler
};

export { registerApiRouteDefinitions, __testables };
