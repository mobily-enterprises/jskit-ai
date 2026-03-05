import { ensureNonEmptyText, normalizeArray, normalizeObject, normalizeText } from "../../../shared/support/normalize.js";
import { RouteDefinitionError } from "./errors.js";
import { resolveRouteContractOptions } from "./routeContract.js";

function normalizeMethod(method) {
  return ensureNonEmptyText(method, "route method").toUpperCase();
}

function normalizePath(pathname) {
  const value = normalizeText(pathname);
  if (!value.startsWith("/")) {
    throw new RouteDefinitionError(`Route path must start with '/': ${value || "<empty>"}`);
  }
  return value.replace(/\/+/g, "/");
}

function joinPath(left, right) {
  const leftPath = normalizeText(left);
  const rightPath = normalizeText(right);

  const normalizedLeft = leftPath ? `/${leftPath.replace(/^\/+|\/+$/g, "")}` : "";
  const normalizedRight = rightPath ? `/${rightPath.replace(/^\/+|\/+$/g, "")}` : "";
  const joined = `${normalizedLeft}${normalizedRight}`.replace(/\/+/g, "/");
  return joined || "/";
}

function normalizeMiddlewareEntry(entry, { context = "middleware" } = {}) {
  if (typeof entry === "function") {
    return entry;
  }

  const normalizedName = normalizeText(entry);
  if (normalizedName) {
    return normalizedName;
  }

  throw new RouteDefinitionError(`${context} entries must be functions or non-empty strings.`);
}

function normalizeMiddlewareStack(value, { context = "middleware" } = {}) {
  return normalizeArray(value).map((entry) => normalizeMiddlewareEntry(entry, { context }));
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
  constructor({ routes = null, prefix = "", middleware = [] } = {}) {
    this._routes = Array.isArray(routes) ? routes : [];
    this._prefix = normalizeText(prefix);
    this._middleware = normalizeMiddlewareStack(middleware, {
      context: "router middleware"
    });
  }

  register(method, path, optionsOrHandler, maybeHandler) {
    const input = normalizeRouteInput(method, path, optionsOrHandler, maybeHandler);
    const resolvedOptions = resolveRouteContractOptions({
      method: input.method,
      path: input.path,
      options: input.options
    });
    const routeMiddleware = normalizeMiddlewareStack(resolvedOptions.middleware, {
      context: `Route ${input.method} ${input.path} middleware`
    });
    const routeInput = Object.prototype.hasOwnProperty.call(resolvedOptions, "input") ? resolvedOptions.input : null;

    const route = Object.freeze({
      id: normalizeText(resolvedOptions.id),
      method: input.method,
      path: joinPath(this._prefix, input.path),
      schema: resolvedOptions.schema,
      input: routeInput,
      config: normalizeObject(resolvedOptions.config),
      auth: resolvedOptions.auth,
      workspacePolicy: resolvedOptions.workspacePolicy,
      workspaceSurface: resolvedOptions.workspaceSurface,
      permission: resolvedOptions.permission,
      ownerParam: resolvedOptions.ownerParam,
      userField: resolvedOptions.userField,
      ownerResolver: resolvedOptions.ownerResolver,
      csrfProtection: resolvedOptions.csrfProtection,
      bodyLimit: resolvedOptions.bodyLimit,
      middleware: Object.freeze([...this._middleware, ...routeMiddleware]),
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

  group({ prefix = "", middleware = [] } = {}, defineRoutes = null) {
    if (typeof defineRoutes !== "function") {
      throw new RouteDefinitionError("group() requires a callback.");
    }

    const nestedRouter = new HttpRouter({
      routes: this._routes,
      prefix: joinPath(this._prefix, prefix || ""),
      middleware: [
        ...this._middleware,
        ...normalizeMiddlewareStack(middleware, {
          context: "group middleware"
        })
      ]
    });

    defineRoutes(nestedRouter);
    return this;
  }

  resource(name, controller, options = {}) {
    this._resource(name, controller, {
      ...normalizeObject(options),
      apiOnly: false
    });
    return this;
  }

  apiResource(name, controller, options = {}) {
    this._resource(name, controller, {
      ...normalizeObject(options),
      apiOnly: true
    });
    return this;
  }

  _resource(name, controller, options = {}) {
    const resourceName = ensureNonEmptyText(name, "resource name");
    const idParam = normalizeText(options.idParam, { fallback: "id" });
    const basePath = `/${resourceName}`;
    const itemPath = `/${resourceName}/:${idParam}`;

    const methods = normalizeObject(controller);
    const middleware = normalizeMiddlewareStack(options.middleware, {
      context: `resource ${resourceName} middleware`
    });

    const requireMethod = (methodName) => {
      const handler = methods[methodName];
      if (typeof handler !== "function") {
        throw new RouteDefinitionError(`resource controller for ${resourceName} is missing method ${methodName}().`);
      }
      return handler;
    };

    this.get(basePath, { middleware }, requireMethod("index"));
    if (!options.apiOnly) {
      this.get(`${basePath}/create`, { middleware }, requireMethod("create"));
      this.get(`${itemPath}/edit`, { middleware }, requireMethod("edit"));
    }
    this.post(basePath, { middleware }, requireMethod("store"));
    this.get(itemPath, { middleware }, requireMethod("show"));
    this.put(itemPath, { middleware }, requireMethod("update"));
    this.delete(itemPath, { middleware }, requireMethod("destroy"));
  }

  list() {
    return Object.freeze([...this._routes]);
  }
}

function createRouter(options = {}) {
  return new HttpRouter(options);
}

export { HttpRouter, createRouter, joinPath };
