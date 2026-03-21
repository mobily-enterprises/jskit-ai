import { KERNEL_TOKENS } from "../../../shared/support/tokens.js";
import { normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { normalizeRouteVisibility } from "../../../shared/support/visibility.js";
import { defaultApplyRoutePolicy, normalizeRoutePolicyConfig } from "../../support/routePolicyConfig.js";
import { ensureApiErrorHandling } from "../../runtime/fastifyBootstrap.js";
import { resolveActionContextContributors } from "../../actions/ActionRuntimeServiceProvider.js";
import { RouteRegistrationError } from "./errors.js";
import { createRouter } from "./router.js";
import { resolveRouteVisibilityContext } from "./visibilityResolver.js";

const { structuredClone: cloneRouteSchema } = globalThis;

function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Route handler is not available in this runtime profile."
  });
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
  const schema = cloneRouteSchema(sourceRoute.schema);
  return {
    method: sourceRoute.method,
    url: sourceRoute.path,
    ...(schema ? { schema } : {}),
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

function normalizeRequestActionExecutorProperty(value) {
  const normalized = String(value || "").trim();
  return normalized || "executeAction";
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

  scope.instance(KERNEL_TOKENS.Request, request);
  scope.instance(KERNEL_TOKENS.Reply, reply);
  scope.instance(KERNEL_TOKENS.RequestId, runtimeRequestId);
  scope.instance(KERNEL_TOKENS.RequestScope, scope);

  if (request && typeof request === "object") {
    request[normalizeRequestScopeProperty(requestScopeProperty)] = scope;
  }

  return scope;
}

function resolveRequestPathname(request) {
  const rawPathname = normalizeText(request?.raw?.url || request?.url || "/");
  const noHash = rawPathname.split("#")[0] || "/";
  return (noHash.split("?")[0] || "/").trim() || "/";
}

function resolveSurfaceFromRequest(request, explicitSurface = "", defaultSurfaceId = "app") {
  const normalizedExplicitSurface = normalizeText(explicitSurface).toLowerCase();
  if (normalizedExplicitSurface) {
    return normalizedExplicitSurface;
  }

  const normalizedRouteSurface = normalizeText(request?.routeOptions?.config?.surface).toLowerCase();
  if (normalizedRouteSurface) {
    return normalizedRouteSurface;
  }

  const normalizedRequestSurface = normalizeText(request?.surface).toLowerCase();
  if (normalizedRequestSurface) {
    return normalizedRequestSurface;
  }

  const normalizedDefaultSurface = normalizeText(defaultSurfaceId).toLowerCase();
  return normalizedDefaultSurface || "app";
}

function buildActionExecutionContext({ request = null, context = {}, channel = "api", defaultSurfaceId = "app" } = {}) {
  const source = normalizeObject(context);
  const sourceRequestMeta = normalizeObject(source.requestMeta);

  const resolvedContext = {
    ...source,
    channel: normalizeText(source.channel || channel).toLowerCase() || "api",
    surface: resolveSurfaceFromRequest(request, source.surface, defaultSurfaceId),
    requestMeta: {
      ...sourceRequestMeta,
      request
    }
  };

  return resolvedContext;
}

function applyActionContextContributionDefaults(targetContext, contribution) {
  const patch = normalizeObject(contribution);
  if (Object.keys(patch).length < 1) {
    return targetContext;
  }

  for (const [key, value] of Object.entries(patch)) {
    if (key === "requestMeta") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(targetContext, key)) {
      continue;
    }
    targetContext[key] = value;
  }

  if (Object.prototype.hasOwnProperty.call(patch, "requestMeta")) {
    const targetRequestMeta = normalizeObject(targetContext.requestMeta);
    const patchRequestMeta = normalizeObject(patch.requestMeta);
    for (const [key, value] of Object.entries(patchRequestMeta)) {
      if (Object.prototype.hasOwnProperty.call(targetRequestMeta, key)) {
        continue;
      }
      targetRequestMeta[key] = value;
    }
    targetContext.requestMeta = targetRequestMeta;
  }

  return targetContext;
}

async function enrichActionExecutionContext({
  resolutionScope = null,
  request = null,
  actionId = "",
  version = null,
  input = {},
  deps = {},
  channel = "api",
  baseContext = {}
} = {}) {
  const contributors = resolveActionContextContributors(resolutionScope);
  if (contributors.length < 1) {
    return baseContext;
  }

  const normalizedActionId = normalizeText(actionId);
  const normalizedChannel = normalizeText(channel).toLowerCase() || "api";
  const normalizedInput = normalizeObject(input);
  const normalizedDeps = normalizeObject(deps);
  const mutableContext = normalizeObject(baseContext);

  for (const contributor of contributors) {
    if (!contributor || typeof contributor.contribute !== "function") {
      continue;
    }

    const contribution = await contributor.contribute({
      request,
      actionId: normalizedActionId,
      version: version == null ? null : version,
      input: normalizedInput,
      deps: normalizedDeps,
      channel: normalizedChannel,
      surface: mutableContext.surface,
      context: { ...mutableContext }
    });

    applyActionContextContributionDefaults(mutableContext, contribution);
  }

  return mutableContext;
}

function resolveActionExecutorScope({ app = null, request = null, requestScopeProperty = "scope" } = {}) {
  const normalizedScopeProperty = normalizeRequestScopeProperty(requestScopeProperty);
  const requestScope =
    request && typeof request === "object" && request[normalizedScopeProperty] && typeof request[normalizedScopeProperty] === "object"
      ? request[normalizedScopeProperty]
      : null;

  if (requestScope && typeof requestScope.make === "function") {
    return requestScope;
  }

  if (app && typeof app.make === "function") {
    return app;
  }

  return null;
}

function resolveRouteVisibilityFromRequestAndPayload(request, payload = {}) {
  const routeConfig =
    request?.routeOptions?.config && typeof request.routeOptions.config === "object" ? request.routeOptions.config : null;
  if (routeConfig && Object.prototype.hasOwnProperty.call(routeConfig, "visibility")) {
    return normalizeRouteVisibility(routeConfig.visibility);
  }

  return normalizeRouteVisibility(payload.visibility);
}

function attachRequestActionExecutor({
  app = null,
  request = null,
  requestScopeProperty = "scope",
  requestActionExecutorProperty = "executeAction",
  actionExecutorToken = "actionExecutor",
  defaultChannel = "api",
  defaultSurfaceId = "app"
} = {}) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const normalizedProperty = normalizeRequestActionExecutorProperty(requestActionExecutorProperty);
  if (typeof request[normalizedProperty] === "function") {
    return request[normalizedProperty];
  }

  const normalizedActionExecutorToken = normalizeText(actionExecutorToken) || "actionExecutor";
  const normalizedDefaultChannel = normalizeText(defaultChannel).toLowerCase() || "api";
  const initialResolutionScope = resolveActionExecutorScope({
    app,
    request,
    requestScopeProperty
  });

  if (!initialResolutionScope || typeof initialResolutionScope.has !== "function" || typeof initialResolutionScope.make !== "function") {
    return null;
  }

  const executeAction = async (payload = {}) => {
    const source = normalizeObject(payload);
    const normalizedInput = normalizeObject(source.input);
    const normalizedDeps = normalizeObject(source.deps);
    const normalizedChannel = normalizeText(source.channel || normalizedDefaultChannel).toLowerCase() || normalizedDefaultChannel;
    const resolutionScope = resolveActionExecutorScope({
      app,
      request,
      requestScopeProperty
    });

    if (!resolutionScope || typeof resolutionScope.has !== "function" || typeof resolutionScope.make !== "function") {
      throw new RouteRegistrationError("request.executeAction requires a container scope with has()/make().");
    }
    if (!resolutionScope.has(normalizedActionExecutorToken)) {
      throw new RouteRegistrationError(`request.executeAction requires "${normalizedActionExecutorToken}" binding.`);
    }

    const actionExecutor = resolutionScope.make(normalizedActionExecutorToken);
    if (!actionExecutor || typeof actionExecutor.execute !== "function") {
      throw new RouteRegistrationError(`"${normalizedActionExecutorToken}" must provide execute().`);
    }

    const baseContext = buildActionExecutionContext({
      request,
      context: normalizeObject(source.context),
      channel: normalizedChannel,
      defaultSurfaceId
    });
    const executionContext = await enrichActionExecutionContext({
      resolutionScope,
      request,
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input: normalizedInput,
      deps: normalizedDeps,
      channel: normalizedChannel,
      baseContext
    });
    const visibilityContext = await resolveRouteVisibilityContext({
      resolutionScope,
      request,
      routeVisibility: resolveRouteVisibilityFromRequestAndPayload(request, source),
      context: executionContext,
      input: normalizedInput,
      deps: normalizedDeps,
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      channel: normalizedChannel
    });
    executionContext.visibilityContext = visibilityContext;
    executionContext.requestMeta = {
      ...normalizeObject(executionContext.requestMeta),
      visibilityContext,
      routeVisibility: visibilityContext.visibility
    };

    return actionExecutor.execute({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input: normalizedInput,
      context: executionContext,
      deps: normalizedDeps
    });
  };

  Object.defineProperty(request, normalizedProperty, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: executeAction
  });

  return request[normalizedProperty];
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
    requestActionExecutorProperty = "executeAction",
    actionExecutorToken = "actionExecutor",
    requestActionDefaultChannel = "api",
    requestActionDefaultSurface = "app",
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
    const routeActionDefaultSurface =
      normalizeText(route?.surface || routeOptions?.config?.surface || requestActionDefaultSurface).toLowerCase() || "app";

    fastify.route({
      ...routeOptions,
      handler: async (request, reply) => {
        if (!request.routeOptions || typeof request.routeOptions !== "object") {
          request.routeOptions = {
            config: normalizeObject(routeOptions?.config)
          };
        } else if (!request.routeOptions.config || typeof request.routeOptions.config !== "object") {
          request.routeOptions.config = normalizeObject(routeOptions?.config);
        }

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

        attachRequestActionExecutor({
          app,
          request,
          requestScopeProperty,
          requestActionExecutorProperty,
          actionExecutorToken,
          defaultChannel: requestActionDefaultChannel,
          defaultSurfaceId: routeActionDefaultSurface
        });

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

  const runtimeOptions = normalizeObject(options);
  const {
    fastifyToken = KERNEL_TOKENS.Fastify,
    routerToken = KERNEL_TOKENS.HttpRouter,
    autoRegisterApiErrorHandling = true,
    apiErrorHandling = {},
    ...routeRegistrationOptions
  } = runtimeOptions;
  const fastify = app.make(fastifyToken);
  const router = app.make(routerToken);
  const routes = typeof router?.list === "function" ? router.list() : [];
  const appConfig =
    typeof app.has === "function" && app.has("appConfig") && typeof app.make === "function" ? normalizeObject(app.make("appConfig")) : {};
  const resolvedDefaultActionSurface =
    normalizeText(routeRegistrationOptions.requestActionDefaultSurface || appConfig.surfaceDefaultId || "app").toLowerCase() || "app";

  if (autoRegisterApiErrorHandling !== false) {
    ensureApiErrorHandling(app, {
      fastifyToken,
      ...normalizeObject(apiErrorHandling)
    });
  }

  return registerRoutes(fastify, {
    ...routeRegistrationOptions,
    requestActionDefaultSurface: resolvedDefaultActionSurface,
    app,
    routes
  });
}

function createHttpRuntime(
  {
    app = null,
    fastify = null,
    router = null,
    autoRegisterApiErrorHandling = true,
    apiErrorHandling = {}
  } = {}
) {
  if (!app || typeof app.singleton !== "function") {
    throw new RouteRegistrationError("createHttpRuntime requires an application instance.");
  }

  const runtimeRouter = router || createRouter();
  app.singleton(KERNEL_TOKENS.HttpRouter, () => runtimeRouter);

  if (fastify) {
    app.instance(KERNEL_TOKENS.Fastify, fastify);
    if (autoRegisterApiErrorHandling !== false) {
      ensureApiErrorHandling(app, {
        fastifyToken: KERNEL_TOKENS.Fastify,
        ...normalizeObject(apiErrorHandling)
      });
    }
  }

  return {
    router: runtimeRouter,
    registerRoutes(runtimeOptions = {}) {
      return registerHttpRuntime(app, {
        autoRegisterApiErrorHandling,
        apiErrorHandling: normalizeObject(apiErrorHandling),
        ...normalizeObject(runtimeOptions)
      });
    }
  };
}

export {
  defaultMissingHandler,
  defaultApplyRoutePolicy,
  normalizeRoutePolicyConfig,
  buildActionExecutionContext,
  attachRequestActionExecutor,
  registerRoutes,
  registerHttpRuntime,
  createHttpRuntime
};
