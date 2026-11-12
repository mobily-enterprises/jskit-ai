import { ensureNonEmptyText, isRecord, normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { RouteDefinitionError } from "./errors.js";
import { resolveRouteValidatorOptions } from "./routeValidator.js";
import { resolveRouteLabel } from "./routeSupport.js";
import { normalizeRouteOutputTransform, normalizeRouteTransport } from "./routeTransport.js";
import { normalizeRouteRateLimit } from "./routeRateLimits.js";

function normalizeMethod(method) {
  return ensureNonEmptyText(method, "route method").toUpperCase();
}

function normalizePath(pathname) {
  const value = normalizeText(pathname);
  if (!value.startsWith("/")) {
    throw new RouteDefinitionError(`Route path must start with '/': ${value || "<empty>"}`);
  }
  return value.replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
}

function normalizeRouteMiddleware(value, routeLabel) {
  const middleware = normalizeArray(value);
  // readable-check: allow method-probe - input validation: a route's middleware entries must be functions
  if (middleware.some((entry) => typeof entry !== "function")) {
    throw new RouteDefinitionError(`Route ${routeLabel} middleware entries must be functions.`);
  }
  return Object.freeze([...middleware]);
}

function normalizeRouteConfig(value, routeLabel) {
  const config = normalizeObject(value);
  if (Object.hasOwn(config, "rateLimit")) {
    throw new RouteDefinitionError(`Route ${routeLabel} declares config.rateLimit; declare rateLimit on the route instead.`);
  }
  return config;
}

/**
 * A route's `secondFactor`, checked when the route is defined: true asks for a
 * second factor done at any time in the request's session, `{ maxAgeSeconds }`
 * for one done within that many seconds. A route that asks for one must sign
 * its caller in, so `auth` must be "required" or "own".
 * @param {unknown} value
 * @param {unknown} auth
 * @param {string} routeLabel
 * @returns {false | true | Readonly<{ maxAgeSeconds: number }>}
 */
function normalizeRouteSecondFactor(value, auth, routeLabel) {
  if (value == null || value === false) {
    return false;
  }
  const valid = value === true || (isRecord(value) && Object.keys(value).length === 1 &&
    Number.isInteger(value.maxAgeSeconds) && value.maxAgeSeconds > 0);
  if (!valid) {
    throw new RouteDefinitionError(`Route ${routeLabel} secondFactor must be true or { maxAgeSeconds } with a positive integer.`);
  }
  if (auth !== "required" && auth !== "own") {
    throw new RouteDefinitionError(`Route ${routeLabel} asks for a second factor, so its auth must be "required" or "own".`);
  }
  return value === true ? true : Object.freeze({ maxAgeSeconds: value.maxAgeSeconds });
}

function normalizeRouteInternal(value, { method = "", path = "" } = {}) {
  if (value == null) {
    return false;
  }
  if (typeof value !== "boolean") {
    throw new RouteDefinitionError(`Route ${resolveRouteLabel({ method, path })} internal must be a boolean.`);
  }
  return value;
}

function normalizeRouteInput(method, path, optionsOrHandler, maybeHandler) {
  const options =
    typeof optionsOrHandler === "function"
      ? {}
      : normalizeObject(optionsOrHandler, {
          fallback: {}
        });
  const handler =
    typeof optionsOrHandler === "function"
      ? optionsOrHandler
      : typeof maybeHandler === "function"
        ? maybeHandler
        : null;

  // readable-check: allow method-probe - input validation: a route must have a handler function
  if (typeof handler !== "function") {
    throw new RouteDefinitionError(`Route ${method} ${path} requires a handler function.`);
  }

  return {
    method: normalizeMethod(method),
    path: normalizePath(path),
    options,
    handler
  };
}

class HttpRouter {
  constructor() {
    this._routes = [];
  }

  register(method, path, optionsOrHandler, maybeHandler) {
    const input = normalizeRouteInput(method, path, optionsOrHandler, maybeHandler);
    const resolvedOptions = resolveRouteValidatorOptions({
      method: input.method,
      path: input.path,
      options: input.options
    });
    const routeLabel = `${input.method} ${input.path}`;
    const routeMiddleware = normalizeRouteMiddleware(resolvedOptions.middleware, routeLabel);
    const routeInput = Object.hasOwn(resolvedOptions, "input") ? resolvedOptions.input : null;
    const routeOutput = normalizeRouteOutputTransform(
      Object.hasOwn(resolvedOptions, "output") ? resolvedOptions.output : null,
      {
        context: `Route ${input.method} ${input.path} output`,
        ErrorType: RouteDefinitionError
      }
    );
    const routeTransport = normalizeRouteTransport(
      Object.hasOwn(resolvedOptions, "transport") ? resolvedOptions.transport : null,
      {
        context: `Route ${input.method} ${input.path} transport`,
        ErrorType: RouteDefinitionError
      }
    );

    const route = Object.freeze({
      id: normalizeText(resolvedOptions.id),
      actionId: normalizeText(resolvedOptions.actionId),
      method: input.method,
      path: input.path,
      schema: resolvedOptions.schema,
      input: routeInput,
      output: routeOutput,
      transport: routeTransport,
      config: normalizeRouteConfig(resolvedOptions.config, routeLabel),
      auth: resolvedOptions.auth,
      contextPolicy: resolvedOptions.contextPolicy,
      surface: resolvedOptions.surface,
      internal: normalizeRouteInternal(resolvedOptions.internal, {
        method: input.method,
        path: input.path
      }),
      visibility: resolvedOptions.visibility,
      permission: resolvedOptions.permission,
      ownerParam: resolvedOptions.ownerParam,
      userField: resolvedOptions.userField,
      ownerResolver: resolvedOptions.ownerResolver,
      csrfProtection: resolvedOptions.csrfProtection,
      secondFactor: normalizeRouteSecondFactor(resolvedOptions.secondFactor, resolvedOptions.auth, routeLabel),
      bodyLimit: resolvedOptions.bodyLimit,
      rateLimit: normalizeRouteRateLimit(resolvedOptions.rateLimit, routeLabel),
      middleware: routeMiddleware,
      handler: input.handler
    });

    this._routes.push(route);
    return this;
  }

  get(path, optionsOrHandler, maybeHandler) {
    return this.register("GET", path, optionsOrHandler, maybeHandler);
  }

  post(path, optionsOrHandler, maybeHandler) {
    return this.register("POST", path, optionsOrHandler, maybeHandler);
  }

  put(path, optionsOrHandler, maybeHandler) {
    return this.register("PUT", path, optionsOrHandler, maybeHandler);
  }

  patch(path, optionsOrHandler, maybeHandler) {
    return this.register("PATCH", path, optionsOrHandler, maybeHandler);
  }

  delete(path, optionsOrHandler, maybeHandler) {
    return this.register("DELETE", path, optionsOrHandler, maybeHandler);
  }

  list() {
    return Object.freeze([...this._routes]);
  }
}

function createRouter() {
  return new HttpRouter();
}

export { HttpRouter, createRouter };
