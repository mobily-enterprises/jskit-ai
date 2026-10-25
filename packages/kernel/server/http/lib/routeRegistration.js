import { normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { AppError } from "../../runtime/errors.js";
import { defaultApplyRoutePolicy } from "../../support/routePolicyConfig.js";
import { resolveDefaultSurfaceId } from "../../support/appConfig.js";
import { defaultMissingHandler } from "../../support/defaultMissingHandler.js";
import { registerJsonApiContentTypeParser } from "../errorHandling.js";
import { RouteRegistrationError } from "./errors.js";
import { executeMiddlewareStack, normalizeRuntimeMiddlewareConfig, resolveRouteMiddlewareHandlers } from "./middlewareRuntime.js";
import { attachDirectRequestActionExecutor } from "../directRequestActionExecutor.js";
import { resolveRouteLabel } from "./routeSupport.js";
import { JSON_API_CONTENT_TYPE } from "./routeTransport.js";

const { structuredClone: cloneRouteSchema } = globalThis;
const UNSAFE_BODY_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);
const REQUEST_INPUT_KEYS = Object.freeze(["body", "query", "params"]);

function toFastifyRouteOptions(route) {
  const schema = cloneRouteSchema(route.schema);
  if (shouldStripFastifyBodySchema(route, schema)) {
    delete schema.body;
  }
  return {
    method: route.method,
    url: route.path,
    ...(schema ? { schema } : {}),
    ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
    config: {
      ...normalizeObject(route.config),
      ...(route.transport ? { transport: route.transport } : {})
    }
  };
}

function shouldStripFastifyBodySchema(route = null, schema = null) {
  if (!route || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(schema, "body")) {
    return false;
  }

  return typeof route?.input?.body === "function";
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

function routeDefinesRequestBody(route = null) {
  if (!route || typeof route !== "object") {
    return false;
  }

  return route.body != null || route.schema?.body != null;
}

function shouldEnforceRequestContentType(method = "", transport = null, route = null) {
  return (
    UNSAFE_BODY_METHODS.includes(String(method || "").toUpperCase()) &&
    normalizeText(transport?.contentType).length > 0 &&
    routeDefinesRequestBody(route)
  );
}

function routeRequiresJsonApiContentTypeParser(route = null) {
  return routeDefinesRequestBody(route) && normalizeMediaType(route?.transport?.contentType) === JSON_API_CONTENT_TYPE;
}

function enforceRequestContentType({ request = null, route = null, transport = null } = {}) {
  if (!shouldEnforceRequestContentType(route?.method, transport, route)) {
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

async function buildRequestInput(request, { inputTransforms = null, transportInputTransforms = null } = {}) {
  const input = {};
  for (const key of REQUEST_INPUT_KEYS) {
    let value = request?.[key];
    const transportTransform = transportInputTransforms?.[key];
    if (typeof transportTransform === "function" && (key !== "body" || value !== undefined)) {
      value = await transportTransform(value, request);
    }
    const inputTransform = inputTransforms?.[key];
    if (typeof inputTransform === "function") {
      value = await inputTransform(value, request);
    }
    input[key] = value;
  }
  return Object.freeze(input);
}

function wrapReplySend({ reply = null, request = null, route = null, outputTransform = null, transport = null } = {}) {
  if (!reply || typeof reply.send !== "function") {
    return;
  }

  const originalSend = reply.send.bind(reply);
  reply.send = function transformedSend(payload) {
    const statusCode = Number(reply?.statusCode || 200);

    if (payload instanceof Error || statusCode >= 400) {
      if (
        normalizeText(transport?.contentType) &&
        !replyHasHeader(reply, "content-type")
      ) {
        reply.header("Content-Type", transport.contentType);
      }

      return originalSend(payload);
    }

    let nextPayload = payload;
    if (typeof transport?.response === "function") {
      const transportedPayload = transport.response(payload, {
        request,
        reply,
        route,
        transport,
        statusCode
      });

      if (transportedPayload && typeof transportedPayload.then === "function") {
        throw new RouteRegistrationError(`Route ${resolveRouteLabel(route)} transport.response must return synchronously.`);
      }

      nextPayload = transportedPayload === undefined ? nextPayload : transportedPayload;
    }

    if (typeof outputTransform === "function") {
      const transformedPayload = outputTransform(nextPayload, {
        request,
        reply,
        route,
        transport,
        statusCode
      });

      if (transformedPayload && typeof transformedPayload.then === "function") {
        throw new RouteRegistrationError(`Route ${resolveRouteLabel(route)} output transform must return synchronously.`);
      }

      nextPayload = transformedPayload === undefined ? nextPayload : transformedPayload;
    }

    if (
      normalizeText(transport?.contentType) &&
      statusCode !== 204 &&
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
    applyRoutePolicy = defaultApplyRoutePolicy,
    missingHandler = defaultMissingHandler,
    requestActionExecutorProperty = "executeAction",
    requestActionDefaultChannel = "api",
    requestActionDefaultSurface = "",
    middleware = {},
    actions = null
  } = {}
) {
  if (!fastify || typeof fastify.route !== "function") {
    throw new RouteRegistrationError("registerRoutes requires a Fastify instance.");
  }
  if (!actions || typeof actions.execute !== "function") {
    throw new RouteRegistrationError("registerRoutes requires the runtime.actions capability.");
  }

  const normalizedRoutes = normalizeArray(routes);
  const publicRoutes = normalizedRoutes.filter((route) => route?.internal !== true);
  const policyApplier = typeof applyRoutePolicy === "function" ? applyRoutePolicy : defaultApplyRoutePolicy;
  const fallbackHandler = typeof missingHandler === "function" ? missingHandler : defaultMissingHandler;
  const runtimeMiddlewareConfig = normalizeRuntimeMiddlewareConfig(middleware);

  if (publicRoutes.some((route) => routeRequiresJsonApiContentTypeParser(route))) {
    registerJsonApiContentTypeParser(fastify);
  }

  for (const route of publicRoutes) {
    const routeOptions = policyApplier(toFastifyRouteOptions(route), route);
    const routeHandler = typeof route.handler === "function" ? route.handler : fallbackHandler;
    const resolvedMiddlewareHandlers = resolveRouteMiddlewareHandlers(route, runtimeMiddlewareConfig);
    const routeTransport = route.transport || null;
    const routeActionDefaultSurface = resolveDefaultSurfaceId(null, {
      defaultSurfaceId: route.surface || routeOptions?.config?.surface || requestActionDefaultSurface
    });

    fastify.route({
      ...routeOptions,
      handler: async (request, reply) => {
        attachDirectRequestActionExecutor({
          actions,
          request,
          property: requestActionExecutorProperty,
          defaultChannel: requestActionDefaultChannel,
          defaultSurfaceId: routeActionDefaultSurface
        });

        enforceRequestContentType({
          request,
          route,
          transport: routeTransport
        });

        const transportInputTransforms = routeTransport?.request || null;
        if (route.input || transportInputTransforms) {
          request.input = await buildRequestInput(request, {
            inputTransforms: route.input,
            transportInputTransforms
          });
        }

        wrapReplySend({
          reply,
          request,
          route,
          outputTransform: route.output,
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
    routeCount: publicRoutes.length
  };
}

export { defaultMissingHandler, registerRoutes };
