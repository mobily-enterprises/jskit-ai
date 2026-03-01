import { ensureNonEmptyText, normalizeArray, normalizeObject, normalizeText } from "@jskit-ai/support-core/normalize";
import { RouteDefinitionError } from "./errors.js";

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

function normalizeMiddlewareStack(value) {
  return normalizeArray(value).filter((entry) => typeof entry === "function");
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
    this._middleware = normalizeMiddlewareStack(middleware);
  }

  register(method, path, optionsOrHandler, maybeHandler) {
    const input = normalizeRouteInput(method, path, optionsOrHandler, maybeHandler);
    const routeMiddleware = normalizeMiddlewareStack(input.options.middleware);

    const route = Object.freeze({
      id: normalizeText(input.options.id),
      method: input.method,
      path: joinPath(this._prefix, input.path),
      schema: input.options.schema,
      config: normalizeObject(input.options.config),
      auth: input.options.auth,
      workspacePolicy: input.options.workspacePolicy,
      workspaceSurface: input.options.workspaceSurface,
      permission: input.options.permission,
      ownerParam: input.options.ownerParam,
      userField: input.options.userField,
      ownerResolver: input.options.ownerResolver,
      csrfProtection: input.options.csrfProtection,
      bodyLimit: input.options.bodyLimit,
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
      middleware: [...this._middleware, ...normalizeMiddlewareStack(middleware)]
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
    const middleware = normalizeMiddlewareStack(options.middleware);

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
