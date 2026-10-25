import { ensureNonEmptyText, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { RouteDefinitionError } from "./errors.js";
import { resolveRouteValidatorOptions } from "./routeValidator.js";
import { normalizeMiddlewareStack as normalizeSharedMiddlewareStack, resolveRouteLabel } from "./routeSupport.js";
import { normalizeRouteOutputTransform, normalizeRouteTransport } from "./routeTransport.js";

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

function normalizeRouterMiddlewareStack(value, { context = "middleware" } = {}) {
  return normalizeSharedMiddlewareStack(value, {
    context,
    ErrorType: RouteDefinitionError,
    entryLabel: "entries",
    includeIndex: false
  });
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
    const routeMiddleware = normalizeRouterMiddlewareStack(resolvedOptions.middleware, {
      context: `Route ${input.method} ${input.path} middleware`
    });
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
      method: input.method,
      path: input.path,
      schema: resolvedOptions.schema,
      input: routeInput,
      output: routeOutput,
      transport: routeTransport,
      config: normalizeObject(resolvedOptions.config),
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
      bodyLimit: resolvedOptions.bodyLimit,
      middleware: Object.freeze(routeMiddleware),
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
