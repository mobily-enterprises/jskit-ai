import { TOKENS } from "../../../shared/support/tokens.js";
import { normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
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

function normalizeMiddlewareName(value) {
  return normalizeText(value);
}

function normalizeMiddlewareEntry(entry, { context = "middleware", index = -1 } = {}) {
  if (typeof entry === "function") {
    return entry;
  }

  const normalizedName = normalizeMiddlewareName(entry);
  if (normalizedName) {
    return normalizedName;
  }

  const indexSuffix = Number.isInteger(index) && index >= 0 ? ` at index ${index}` : "";
  throw new RouteRegistrationError(`${context} entry${indexSuffix} must be a function or non-empty string.`);
}

function normalizeMiddlewareAliases(sourceAliases) {
  const source = sourceAliases && typeof sourceAliases === "object" && !Array.isArray(sourceAliases) ? sourceAliases : {};
  const aliases = new Map();

  for (const [rawName, handler] of Object.entries(source)) {
    const name = normalizeMiddlewareName(rawName);
    if (!name) {
      continue;
    }

    if (typeof handler !== "function") {
      throw new RouteRegistrationError(`middleware.aliases["${name}"] must be a function.`);
    }

    aliases.set(name, handler);
  }

  return aliases;
}

function normalizeMiddlewareGroups(sourceGroups) {
  const source = sourceGroups && typeof sourceGroups === "object" && !Array.isArray(sourceGroups) ? sourceGroups : {};
  const groups = new Map();

  for (const [rawName, entries] of Object.entries(source)) {
    const name = normalizeMiddlewareName(rawName);
    if (!name) {
      continue;
    }

    const normalizedEntries = normalizeArray(entries).map((entry, index) =>
      normalizeMiddlewareEntry(entry, {
        context: `middleware.groups["${name}"]`,
        index
      })
    );

    groups.set(name, Object.freeze(normalizedEntries));
  }

  return groups;
}

function normalizeRuntimeMiddlewareConfig(runtimeMiddleware) {
  const source = runtimeMiddleware && typeof runtimeMiddleware === "object" && !Array.isArray(runtimeMiddleware) ? runtimeMiddleware : {};
  const aliases = normalizeMiddlewareAliases(source.aliases);
  const groups = normalizeMiddlewareGroups(source.groups);

  for (const groupName of groups.keys()) {
    if (aliases.has(groupName)) {
      throw new RouteRegistrationError(`middleware name "${groupName}" cannot be both an alias and a group.`);
    }
  }

  return {
    aliases,
    groups
  };
}

function resolveRouteLabel(route) {
  const method = String(route?.method || "<unknown>").toUpperCase();
  const path = String(route?.path || "<unknown>");
  return `${method} ${path}`;
}

function expandMiddlewareEntry({
  entry,
  runtimeMiddlewareConfig,
  resolvedHandlers,
  groupStack,
  routeLabel
}) {
  if (typeof entry === "function") {
    resolvedHandlers.push(entry);
    return;
  }

  const name = normalizeMiddlewareName(entry);
  if (!name) {
    throw new RouteRegistrationError(`Route ${routeLabel} middleware entries must be functions or non-empty strings.`);
  }

  if (runtimeMiddlewareConfig.aliases.has(name)) {
    resolvedHandlers.push(runtimeMiddlewareConfig.aliases.get(name));
    return;
  }

  if (runtimeMiddlewareConfig.groups.has(name)) {
    if (groupStack.includes(name)) {
      const cycle = [...groupStack, name].join(" -> ");
      throw new RouteRegistrationError(`Route ${routeLabel} middleware group cycle detected: ${cycle}.`);
    }

    const nextGroupStack = [...groupStack, name];
    const groupEntries = runtimeMiddlewareConfig.groups.get(name);
    for (const groupEntry of groupEntries) {
      expandMiddlewareEntry({
        entry: groupEntry,
        runtimeMiddlewareConfig,
        resolvedHandlers,
        groupStack: nextGroupStack,
        routeLabel
      });
    }
    return;
  }

  throw new RouteRegistrationError(
    `Route ${routeLabel} references unknown middleware "${name}". Define it under middleware.aliases or middleware.groups.`
  );
}

function resolveRouteMiddlewareHandlers(route, runtimeMiddlewareConfig) {
  const routeLabel = resolveRouteLabel(route);
  const sourceEntries = normalizeArray(route?.middleware).map((entry, index) =>
    normalizeMiddlewareEntry(entry, {
      context: `Route ${routeLabel} middleware`,
      index
    })
  );

  const resolvedHandlers = [];
  for (const entry of sourceEntries) {
    expandMiddlewareEntry({
      entry,
      runtimeMiddlewareConfig,
      resolvedHandlers,
      groupStack: [],
      routeLabel
    });
  }

  return Object.freeze(resolvedHandlers);
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

function normalizeRouteInputTransforms(route) {
  const routeInput = route?.input;
  if (routeInput == null) {
    return null;
  }

  if (!routeInput || typeof routeInput !== "object" || Array.isArray(routeInput)) {
    throw new RouteRegistrationError(
      `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} input must be an object.`
    );
  }

  const normalized = {};
  for (const key of ["body", "query", "params"]) {
    if (!Object.prototype.hasOwnProperty.call(routeInput, key)) {
      continue;
    }

    const transform = routeInput[key];
    if (transform == null) {
      continue;
    }

    if (typeof transform !== "function") {
      throw new RouteRegistrationError(
        `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} input.${key} must be a function.`
      );
    }

    normalized[key] = transform;
  }

  return Object.freeze(normalized);
}

function buildRequestInput({ request = null, inputTransforms = null } = {}) {
  const transforms = inputTransforms && typeof inputTransforms === "object" ? inputTransforms : {};

  const body = typeof transforms.body === "function" ? transforms.body(request?.body, request) : request?.body;
  const query = typeof transforms.query === "function" ? transforms.query(request?.query, request) : request?.query;
  const params = typeof transforms.params === "function" ? transforms.params(request?.params, request) : request?.params;

  return Object.freeze({
    body,
    query,
    params
  });
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
    requestIdResolver = null,
    middleware = {}
  } = {}
) {
  if (!fastify || typeof fastify.route !== "function") {
    throw new RouteRegistrationError("registerRoutes requires a Fastify instance.");
  }

  const normalizedRoutes = normalizeArray(routes);
  const policyApplier = typeof applyRoutePolicy === "function" ? applyRoutePolicy : defaultApplyRoutePolicy;
  const fallbackHandler = typeof missingHandler === "function" ? missingHandler : defaultMissingHandler;
  const runtimeMiddlewareConfig = normalizeRuntimeMiddlewareConfig(middleware);

  for (const route of normalizedRoutes) {
    const baseOptions = toFastifyRouteOptions(route);
    const routeOptions = policyApplier(baseOptions, route);
    const routeHandler = typeof route?.handler === "function" ? route.handler : fallbackHandler;
    const resolvedMiddlewareHandlers = resolveRouteMiddlewareHandlers(route, runtimeMiddlewareConfig);
    const routeInputTransforms = normalizeRouteInputTransforms(route);

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

        if (routeInputTransforms) {
          request.input = buildRequestInput({
            request,
            inputTransforms: routeInputTransforms
          });
        }

        await executeMiddlewareStack(resolvedMiddlewareHandlers, request, reply);
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
