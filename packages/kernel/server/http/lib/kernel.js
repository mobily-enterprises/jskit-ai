import { TOKENS } from "../../../shared/support/tokens.js";
import { normalizeArray, normalizeObject } from "../../../shared/support/normalize.js";
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

function resolveRequestRuntimeId({ request = null, requestIdResolver = null } = {}) {
  if (typeof requestIdResolver === "function") {
    const resolvedByResolver = String(requestIdResolver(request) || "").trim();
    if (resolvedByResolver) {
      return resolvedByResolver;
    }
  }

  const resolvedFromRequest = String(request?.id || "").trim();
  if (resolvedFromRequest) {
    return resolvedFromRequest;
  }

  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRequestScopeProperty(value) {
  const normalized = String(value || "").trim();
  return normalized || "scope";
}

function attachRequestScope({
  app = null,
  request = null,
  reply = null,
  requestScopeProperty = "scope",
  requestScopeIdPrefix = "http",
  requestIdResolver = null
} = {}) {
  if (!app || typeof app.createScope !== "function") {
    return null;
  }

  const runtimeRequestId = resolveRequestRuntimeId({
    request,
    requestIdResolver
  });

  const scopePrefix = String(requestScopeIdPrefix || "").trim() || "http";
  const scope = app.createScope(`${scopePrefix}:${runtimeRequestId}`);
  if (!scope || typeof scope.instance !== "function") {
    return null;
  }

  scope.instance(TOKENS.Request, request);
  scope.instance(TOKENS.Reply, reply);
  scope.instance(TOKENS.RequestId, runtimeRequestId);
  scope.instance(TOKENS.RequestScope, scope);

  if (request && typeof request === "object") {
    request[normalizeRequestScopeProperty(requestScopeProperty)] = scope;
  }

  return scope;
}

function registerRoutes(
  fastify,
  {
    routes = [],
    app = null,
    applyRoutePolicy = defaultApplyRoutePolicy,
    missingHandler = defaultMissingHandler,
    enableRequestScope = true,
    requestScopeProperty = "scope",
    requestScopeIdPrefix = "http",
    requestIdResolver = null
  } = {}
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
        if (enableRequestScope) {
          attachRequestScope({
            app,
            request,
            reply,
            requestScopeProperty,
            requestScopeIdPrefix,
            requestIdResolver
          });
        }

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
    app,
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
    registerRoutes(runtimeOptions = {}) {
      return registerHttpRuntime(app, runtimeOptions);
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
