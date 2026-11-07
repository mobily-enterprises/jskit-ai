import { deepFreeze } from "../../../shared/support/deepFreeze.js";
import { isRecord, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { AppError } from "../../runtime/errors.js";
import { applyRoutePolicy } from "../../support/routePolicyConfig.js";
import { normalizeSurfaceId } from "../../../shared/surface/registry.js";
import { registerJsonApiContentTypeParser } from "../errorHandling.js";
import { RouteRegistrationError } from "./errors.js";
import { attachDirectRequestActionExecutor } from "../directRequestActionExecutor.js";
import { resolveRouteLabel } from "./routeSupport.js";
import { JSON_API_CONTENT_TYPE } from "./routeTransport.js";
import { rateLimitRouteConfig } from "./routeRateLimits.js";
import { schemaCacheKey } from "../responseSerializerFactory.js";

/** @typedef {import("../../types.js").ActionCatalogue} ActionCatalogue */
/** @typedef {import("../../types.js").RuntimeFastify} RuntimeFastify */

const { structuredClone: cloneRouteSchema } = globalThis;
const UNSAFE_BODY_METHODS = Object.freeze(["POST", "PUT", "PATCH"]);
const REQUEST_INPUT_KEYS = Object.freeze(["body", "query", "params"]);
const VALIDATION_SCHEMA_PARTS = Object.freeze(["body", "querystring", "params", "headers"]);
// Fastify's Ajv compiles each schema object it has not seen before, and every route's schema is a fresh copy, so
// routes sharing a schema (a record id, a list query) compiled it once each. One object per distinct JSON schema in
// the process makes it once per server instead.
const validationSchemas = new Map();

function sharedValidationSchema(schema) {
  const key = schemaCacheKey(schema);
  if (key === undefined) {
    return schema;
  }
  if (!validationSchemas.has(key)) {
    validationSchemas.set(key, deepFreeze(schema));
  }
  return validationSchemas.get(key);
}

function toFastifyRouteOptions(route) {
  const schema = cloneRouteSchema(route.schema);
  if (shouldStripFastifyBodySchema(route, schema)) {
    delete schema.body;
  }
  for (const part of VALIDATION_SCHEMA_PARTS) {
    if (isRecord(schema?.[part])) {
      schema[part] = sharedValidationSchema(schema[part]);
    }
  }
  return {
    method: route.method,
    url: route.path,
    ...(schema ? { schema } : {}),
    ...(route.bodyLimit ? { bodyLimit: route.bodyLimit } : {}),
    config: {
      ...normalizeObject(route.config),
      ...(route.transport ? { transport: route.transport } : {}),
      ...rateLimitRouteConfig(route.rateLimit)
    }
  };
}

function shouldStripFastifyBodySchema(route, schema) {
  if (!isRecord(schema) || !Object.hasOwn(schema, "body")) {
    return false;
  }

  // readable-check: allow method-probe - data: a route may transform its body input
  return typeof route.input?.body === "function";
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

function routeDefinesRequestBody(route) {
  return route.schema?.body != null;
}

function shouldEnforceRequestContentType(route, transport) {
  return (
    UNSAFE_BODY_METHODS.includes(route.method) &&
    normalizeText(transport?.contentType).length > 0 &&
    routeDefinesRequestBody(route)
  );
}

function routeRequiresJsonApiContentTypeParser(route) {
  return routeDefinesRequestBody(route) && normalizeMediaType(route.transport?.contentType) === JSON_API_CONTENT_TYPE;
}

function enforceRequestContentType({ request, route, transport }) {
  if (!shouldEnforceRequestContentType(route, transport)) {
    return;
  }

  const expectedContentType = normalizeMediaType(transport.contentType);
  const actualContentType = normalizeMediaType(request.headers["content-type"]);
  if (actualContentType === expectedContentType) {
    return;
  }

  throw new AppError(415, `Content-Type must be ${transport.contentType}.`, {
    code: "unsupported_media_type",
    params: { contentType: transport.contentType }
  });
}

async function buildRequestInput(request, { inputTransforms, transportInputTransforms }) {
  const input = {};
  for (const key of REQUEST_INPUT_KEYS) {
    let value = request[key];
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

async function executeMiddlewareStack(middleware, request, reply) {
  for (const handler of middleware) {
    await handler(request, reply);
    if (reply.sent) {
      return;
    }
  }
}

function wrapReplySend({ reply, request, route, outputTransform, transport }) {
  const originalSend = reply.send.bind(reply);
  reply.send = function transformedSend(payload) {
    const statusCode = Number(reply.statusCode || 200);

    if (payload instanceof Error || statusCode >= 400) {
      if (
        normalizeText(transport?.contentType) &&
        !reply.hasHeader("content-type")
      ) {
        reply.header("Content-Type", transport.contentType);
      }

      return originalSend(payload);
    }

    let nextPayload = payload;
    // readable-check: allow method-probe - data: a route's transport may define a response serializer
    if (typeof transport?.response === "function") {
      const transportedPayload = transport.response(payload, {
        request,
        reply,
        route,
        transport,
        statusCode
      });

      // readable-check: allow method-probe - data: a serializer's result must not be a promise
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

      // readable-check: allow method-probe - data: an output transform's result must not be a promise
      if (transformedPayload && typeof transformedPayload.then === "function") {
        throw new RouteRegistrationError(`Route ${resolveRouteLabel(route)} output transform must return synchronously.`);
      }

      nextPayload = transformedPayload === undefined ? nextPayload : transformedPayload;
    }

    if (
      normalizeText(transport?.contentType) &&
      statusCode !== 204 &&
      !reply.hasHeader("content-type")
    ) {
      reply.header("Content-Type", transport.contentType);
    }

    return originalSend(nextPayload);
  };
}

/**
 * @param {RuntimeFastify} fastify
 * @param {object} options
 * @param {ReadonlyArray<any>} options.routes The router's routes, each with its handler.
 * @param {ActionCatalogue} options.actions
 */
function registerRoutes(fastify, { routes, actions }) {
  const publicRoutes = routes.filter((route) => route.internal !== true);

  if (publicRoutes.some((route) => routeRequiresJsonApiContentTypeParser(route))) {
    registerJsonApiContentTypeParser(fastify);
  }

  for (const route of publicRoutes) {
    const routeOptions = applyRoutePolicy(toFastifyRouteOptions(route), route);
    const routeTransport = route.transport || null;
    const routeActionDefaultSurface = normalizeSurfaceId(route.surface || routeOptions.config.surface);

    fastify.route({
      ...routeOptions,
      handler: /** @param {any} request Decorated with input and executeAction(). */ async (request, reply) => {
        attachDirectRequestActionExecutor({
          actions,
          request,
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

        await executeMiddlewareStack(route.middleware, request, reply);
        if (reply.sent) {
          return;
        }
        await route.handler(request, reply);
      }
    });
  }

  return {
    routeCount: publicRoutes.length
  };
}

export { registerRoutes };
