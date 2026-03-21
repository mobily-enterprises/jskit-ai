import { defaultMissingHandler } from "./routeUtils.js";
import { defaultApplyRoutePolicy, normalizeRoutePolicyConfig } from "../support/routePolicyConfig.js";
import { isRecord } from "../../shared/support/normalize.js";

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
