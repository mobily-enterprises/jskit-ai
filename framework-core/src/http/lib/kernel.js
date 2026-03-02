import { TOKENS } from "../../support/lib/tokens.js";
import { normalizeArray, normalizeObject } from "../../support/lib/normalize.js";
import { RouteRegistrationError } from "./errors.js";
import { createRouter } from "./router.js";

function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Route handler is not available in this runtime profile."
  });
}

function normalizeRoutePolicyConfig(routeOptions, route) {
  const sourceRouteOptions = routeOptions && typeof routeOptions === "object" ? routeOptions : {};
  const sourceConfig =
    sourceRouteOptions.config && typeof sourceRouteOptions.config === "object" ? sourceRouteOptions.config : {};
  const sourceRoute = route && typeof route === "object" ? route : {};

  const nextConfig = { ...sourceConfig };

  if (Object.prototype.hasOwnProperty.call(sourceRoute, "auth")) {
    nextConfig.authPolicy = sourceRoute.auth;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "workspacePolicy")) {
    nextConfig.workspacePolicy = sourceRoute.workspacePolicy;
  }
  if (Object.prototype.hasOwnProperty.call(sourceRoute, "workspaceSurface")) {
    nextConfig.workspaceSurface = sourceRoute.workspaceSurface;
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

async function executeMiddlewareStack(middleware, request, reply) {
  for (const handler of normalizeArray(middleware)) {
    await handler(request, reply);
    if (reply?.sent) {
      return;
    }
  }
}

function toFastifyRouteOptions(route) {
  const sourceRoute = normalizeObject(route);
  return {
    method: sourceRoute.method,
    url: sourceRoute.path,
    ...(sourceRoute.schema ? { schema: sourceRoute.schema } : {}),
    ...(sourceRoute.bodyLimit ? { bodyLimit: sourceRoute.bodyLimit } : {}),
    config: {
      ...(sourceRoute.config || {})
    }
  };
}

function registerRoutes(
  fastify,
  { routes = [], applyRoutePolicy = defaultApplyRoutePolicy, missingHandler = defaultMissingHandler } = {}
) {
  if (!fastify || typeof fastify.route !== "function") {
    throw new RouteRegistrationError("registerRoutes requires a Fastify instance.");
  }

  const normalizedRoutes = normalizeArray(routes);
  const policyApplier = typeof applyRoutePolicy === "function" ? applyRoutePolicy : defaultApplyRoutePolicy;
  const fallbackHandler = typeof missingHandler === "function" ? missingHandler : defaultMissingHandler;

  for (const route of normalizedRoutes) {
    const baseOptions = toFastifyRouteOptions(route);
    const routeOptions = policyApplier(baseOptions, route);
    const routeHandler = typeof route?.handler === "function" ? route.handler : fallbackHandler;
    const middleware = normalizeArray(route?.middleware).filter((entry) => typeof entry === "function");

    fastify.route({
      ...routeOptions,
      handler: async (request, reply) => {
        await executeMiddlewareStack(middleware, request, reply);
        if (reply?.sent) {
          return;
        }
        await routeHandler(request, reply);
      }
    });
  }

  return {
    routeCount: normalizedRoutes.length
  };
}

function registerHttpRuntime(app, options = {}) {
  if (!app || typeof app.make !== "function") {
    throw new RouteRegistrationError("registerHttpRuntime requires an application instance.");
  }

  const fastifyToken = options.fastifyToken || TOKENS.Fastify;
  const routerToken = options.routerToken || TOKENS.HttpRouter;
  const fastify = app.make(fastifyToken);
  const router = app.make(routerToken);
  const routes = typeof router?.list === "function" ? router.list() : [];

  return registerRoutes(fastify, {
    ...options,
    routes
  });
}

function createHttpRuntime({ app = null, fastify = null, router = null } = {}) {
  if (!app || typeof app.singleton !== "function") {
    throw new RouteRegistrationError("createHttpRuntime requires an application instance.");
  }

  const runtimeRouter = router || createRouter();
  app.singleton(TOKENS.HttpRouter, () => runtimeRouter);

  if (fastify) {
    app.instance(TOKENS.Fastify, fastify);
  }

  return {
    router: runtimeRouter,
    registerRoutes() {
      return registerHttpRuntime(app);
    }
  };
}

export {
  defaultMissingHandler,
  defaultApplyRoutePolicy,
  normalizeRoutePolicyConfig,
  registerRoutes,
  registerHttpRuntime,
  createHttpRuntime
};
