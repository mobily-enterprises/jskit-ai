import { normalizeArray, normalizeObject } from "../../../shared/support/normalize.js";
import { defaultApplyRoutePolicy } from "../../support/routePolicyConfig.js";
import { resolveDefaultSurfaceId } from "../../support/appConfig.js";
import { RouteRegistrationError } from "./errors.js";
import { executeMiddlewareStack, normalizeRuntimeMiddlewareConfig, resolveRouteMiddlewareHandlers } from "./middlewareRuntime.js";
import { attachRequestScope } from "./requestScope.js";
import { attachRequestActionExecutor } from "./requestActionExecutor.js";

const { structuredClone: cloneRouteSchema } = globalThis;

function defaultMissingHandler(_request, reply) {
  reply.code(501).send({
    error: "Route handler is not available in this runtime profile."
  });
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
    requestActionDefaultSurface = "",
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
    const routeActionDefaultSurface = resolveDefaultSurfaceId(null, {
      defaultSurfaceId: route?.surface || routeOptions?.config?.surface || requestActionDefaultSurface
    });

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

export { defaultMissingHandler, registerRoutes };
