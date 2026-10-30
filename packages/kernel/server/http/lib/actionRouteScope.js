import { resolveScopedApiBasePath } from "../../../shared/surface/apiPaths.js";
import { normalizeSurfaceId } from "../../../shared/surface/registry.js";
import { normalizeText } from "../../../shared/support/normalize.js";
import { RouteDefinitionError } from "./errors.js";

const emptyInput = () => ({});

// A group of HTTP routes under one scoped API base. Action routes name the
// action they run, so the route table and static inspection both see it.
// Keep the scope options and each actionRoute's method, suffix and actionId
// literal (or a literal array's .map / for...of element) so inspectors can
// read them without running the application.
function createActionRouteScope(
  http,
  {
    routeBase = "/",
    relativePath = "",
    surface = "",
    strictParams = false,
    wrapHandler = null
  } = {}
) {
  const router = http?.router;
  if (!router || typeof router.register !== "function") {
    throw new RouteDefinitionError("createActionRouteScope requires runtime.http with router.register().");
  }
  if (wrapHandler != null && typeof wrapHandler !== "function") {
    throw new RouteDefinitionError("createActionRouteScope wrapHandler must be a function.");
  }

  const scopeBase = resolveScopedApiBasePath({ routeBase, relativePath, strictParams });
  const scopeSurface = normalizeSurfaceId(surface);

  function register(method, suffix, options, handler) {
    if (typeof handler !== "function") {
      throw new RouteDefinitionError(`Route ${method} ${scopeBase}${suffix} requires a handler function.`);
    }
    const path = `${scopeBase}${suffix}`;
    const routeOptions = { ...options, ...(scopeSurface ? { surface: scopeSurface } : {}) };
    const routeHandler = wrapHandler ? wrapHandler(handler, { method, path, options: routeOptions }) : handler;
    router.register(method, path, routeOptions, routeHandler);
  }

  function actionRoute(method, suffix, options = {}) {
    const actionId = normalizeText(options.actionId);
    if (!actionId) {
      throw new RouteDefinitionError(`actionRoute requires an actionId: ${method} ${scopeBase}${suffix}.`);
    }
    const buildInput = options.buildInput ?? emptyInput;
    register(method, suffix, { ...options, actionId }, (request) =>
      request.executeAction({ actionId, input: buildInput(request) })
    );
  }

  function serviceRoute(method, suffix, options, handler) {
    register(method, suffix, options, handler);
  }

  return Object.freeze({ routeBase: scopeBase, actionRoute, serviceRoute });
}

export { createActionRouteScope };
