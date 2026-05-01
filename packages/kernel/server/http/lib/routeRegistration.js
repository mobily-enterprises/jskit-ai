import { normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { AppError } from "../../runtime/errors.js";
import { defaultApplyRoutePolicy } from "../../support/routePolicyConfig.js";
import { resolveDefaultSurfaceId } from "../../support/appConfig.js";
import { defaultMissingHandler } from "../../support/defaultMissingHandler.js";
import { RouteRegistrationError } from "./errors.js";
import { executeMiddlewareStack, normalizeRuntimeMiddlewareConfig, resolveRouteMiddlewareHandlers } from "./middlewareRuntime.js";
import { attachRequestScope } from "./requestScope.js";
import { attachRequestActionExecutor } from "./requestActionExecutor.js";
import { normalizeRouteOutputTransform, normalizeRouteTransport } from "./routeTransport.js";

const { structuredClone: cloneRouteSchema } = globalThis;
const UNSAFE_BODY_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);

function toFastifyRouteOptions(route) {
  const sourceRoute = normalizeObject(route);
  const schema = cloneRouteSchema(sourceRoute.schema);
  const existingConfig = normalizeObject(sourceRoute.config);
  const transportKind = normalizeText(sourceRoute?.transport?.kind).toLowerCase();
  const existingTransportConfig =
    existingConfig.transport && typeof existingConfig.transport === "object" && !Array.isArray(existingConfig.transport)
      ? normalizeObject(existingConfig.transport)
      : {};
  return {
    method: sourceRoute.method,
    url: sourceRoute.path,
    ...(schema ? { schema } : {}),
    ...(sourceRoute.bodyLimit ? { bodyLimit: sourceRoute.bodyLimit } : {}),
    config: {
      ...existingConfig,
      ...(transportKind
        ? {
            transport: {
              ...existingTransportConfig,
              kind: transportKind,
              runtime: sourceRoute.transport,
              ...(normalizeText(sourceRoute?.transport?.contentType)
                ? {
                    contentType: normalizeText(sourceRoute.transport.contentType)
                  }
                : {})
            }
          }
        : {})
    }
  };
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function normalizeMediaType(value = "") {
  return normalizeHeaderValue(value)
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function shouldEnforceRequestContentType(method = "", transport = null) {
  return UNSAFE_BODY_METHODS.includes(String(method || "").toUpperCase()) && normalizeText(transport?.contentType).length > 0;
}

function enforceRequestContentType({ request = null, route = null, transport = null } = {}) {
  if (!shouldEnforceRequestContentType(route?.method, transport)) {
    return;
  }

  const expectedContentType = normalizeMediaType(transport?.contentType);
  const actualContentType = normalizeMediaType(request?.headers?.["content-type"]);
  if (actualContentType === expectedContentType) {
    return;
  }

  throw new AppError(415, `Content-Type must be ${transport.contentType}.`, {
    code: "unsupported_media_type"
  });
}

function attachRouteTransport(request, transport = null) {
  if (!request || !transport) {
    return;
  }

  Object.defineProperty(request, "routeTransport", {
    value: transport,
    enumerable: false,
    configurable: true,
    writable: false
  });
}

function replyHasHeader(reply, name = "") {
  const normalizedName = String(name || "").trim().toLowerCase();
  if (!normalizedName || !reply) {
    return false;
  }

  if (typeof reply.hasHeader === "function") {
    return reply.hasHeader(normalizedName);
  }

  if (typeof reply.getHeader === "function") {
    return reply.getHeader(normalizedName) != null;
  }

  if (reply.headers && typeof reply.headers === "object") {
    return Object.keys(reply.headers).some((key) => String(key || "").trim().toLowerCase() === normalizedName);
  }

  return false;
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
    if (!Object.hasOwn(routeInput, key)) {
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

async function buildRequestInput({ request = null, inputTransforms = null, transportInputTransforms = null } = {}) {
  const transforms = inputTransforms && typeof inputTransforms === "object" ? inputTransforms : {};
  const transportTransforms =
    transportInputTransforms && typeof transportInputTransforms === "object" ? transportInputTransforms : {};

  let body = request?.body;
  if (body !== undefined && typeof transportTransforms.body === "function") {
    body = await transportTransforms.body(body, request);
  }
  if (typeof transforms.body === "function") {
    body = await transforms.body(body, request);
  }

  let query = request?.query;
  if (typeof transportTransforms.query === "function") {
    query = await transportTransforms.query(query, request);
  }
  if (typeof transforms.query === "function") {
    query = await transforms.query(query, request);
  }

  let params = request?.params;
  if (typeof transportTransforms.params === "function") {
    params = await transportTransforms.params(params, request);
  }
  if (typeof transforms.params === "function") {
    params = await transforms.params(params, request);
  }

  return Object.freeze({
    body,
    query,
    params
  });
}

function wrapReplySend({ reply = null, request = null, route = null, outputTransform = null, transport = null } = {}) {
  if (!reply || typeof reply.send !== "function") {
    return;
  }

  const originalSend = reply.send.bind(reply);
  reply.send = function transformedSend(payload) {
    let nextPayload = payload;
    if (typeof transport?.response === "function") {
      const transportedPayload = transport.response(payload, {
        request,
        reply,
        route,
        transport,
        statusCode: Number(reply?.statusCode || 200)
      });

      if (transportedPayload && typeof transportedPayload.then === "function") {
        throw new RouteRegistrationError(
          `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} transport.response must return synchronously.`
        );
      }

      nextPayload = transportedPayload === undefined ? nextPayload : transportedPayload;
    }

    if (typeof outputTransform === "function") {
      const transformedPayload = outputTransform(nextPayload, {
        request,
        reply,
        route,
        transport,
        statusCode: Number(reply?.statusCode || 200)
      });

      if (transformedPayload && typeof transformedPayload.then === "function") {
        throw new RouteRegistrationError(
          `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} output transform must return synchronously.`
        );
      }

      nextPayload = transformedPayload === undefined ? nextPayload : transformedPayload;
    }

    if (
      normalizeText(transport?.contentType) &&
      Number(reply?.statusCode || 200) !== 204 &&
      !replyHasHeader(reply, "content-type")
    ) {
      reply.header("Content-Type", transport.contentType);
    }

    return originalSend(nextPayload);
  };
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
    const routeTransport = normalizeRouteTransport(route?.transport, {
      context: `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} transport`,
      ErrorType: RouteRegistrationError
    });
    const routeOutputTransform = normalizeRouteOutputTransform(route?.output, {
      context: `Route ${String(route?.method || "<unknown>")} ${String(route?.path || "<unknown>")} output`,
      ErrorType: RouteRegistrationError
    });
    const normalizedRoute = {
      ...route,
      transport: routeTransport,
      output: routeOutputTransform
    };
    const baseOptions = toFastifyRouteOptions(normalizedRoute);
    const routeOptions = policyApplier(baseOptions, normalizedRoute);
    const routeHandler = typeof normalizedRoute?.handler === "function" ? normalizedRoute.handler : fallbackHandler;
    const resolvedMiddlewareHandlers = resolveRouteMiddlewareHandlers(normalizedRoute, runtimeMiddlewareConfig);
    const routeInputTransforms = normalizeRouteInputTransforms(normalizedRoute);
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

        attachRouteTransport(request, routeTransport);
        enforceRequestContentType({
          request,
          route: normalizedRoute,
          transport: routeTransport
        });

        const transportInputTransforms = routeTransport?.request || null;
        if (routeInputTransforms || transportInputTransforms) {
          request.input = await buildRequestInput({
            request,
            inputTransforms: routeInputTransforms,
            transportInputTransforms
          });
        }

        wrapReplySend({
          reply,
          request,
          route: normalizedRoute,
          outputTransform: routeOutputTransform,
          transport: routeTransport
        });

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
