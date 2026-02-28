import { defaultMissingHandler } from "./routeUtils.js";

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

function defaultApplyRoutePolicy(routeOptions) {
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
  defaultMissingHandler
};

export { registerApiRouteDefinitions, __testables };
