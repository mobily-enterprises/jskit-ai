import { defaultMissingHandler } from "./routeUtils.js";
import { normalizeRouteVisibility } from "../../shared/support/visibility.js";

function buildBaseRouteOptions(route) {
  return {
    method: route.method,
    url: route.path,
    ...(route.schema ? { schema: route.schema } : {}),
    ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
    config: {
      ...(route.rateLimit ? { rateLimit: route.rateLimit } : {})
    }
  };
}

function normalizeRoutePolicyConfig(routeOptions, route) {
  const sourceRouteOptions = routeOptions && typeof routeOptions === "object" ? routeOptions : {};
  const sourceConfig =
    sourceRouteOptions.config && typeof sourceRouteOptions.config === "object" ? sourceRouteOptions.config : {};
  const sourceRoute = route && typeof route === "object" ? route : {};

  const nextConfig = {
    ...sourceConfig
  };

  if (Object.prototype.hasOwnProperty.call(sourceRoute, "auth")) {
    nextConfig.authPolicy = sourceRoute.auth;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "workspacePolicy")) {
    nextConfig.workspacePolicy = sourceRoute.workspacePolicy;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "workspaceSurface")) {
    nextConfig.workspaceSurface = sourceRoute.workspaceSurface;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "visibility")) {
    nextConfig.visibility = normalizeRouteVisibility(sourceRoute.visibility);
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "permission")) {
    nextConfig.permission = sourceRoute.permission;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "ownerParam")) {
    nextConfig.ownerParam = sourceRoute.ownerParam;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "userField")) {
    nextConfig.userField = sourceRoute.userField;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "ownerResolver")) {
    nextConfig.ownerResolver = sourceRoute.ownerResolver;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "csrfProtection")) {
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
    const routeHandler = route && typeof route.handler === "function" ? route.handler : fallbackHandler;
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
