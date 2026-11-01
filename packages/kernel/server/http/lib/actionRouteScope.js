import { resolveScopedApiBasePath } from "../../../shared/surface/apiPaths.js";
import { normalizeSurfaceId } from "../../../shared/surface/registry.js";
import { normalizeText } from "../../../shared/support/normalize.js";
import { RouteDefinitionError } from "./errors.js";

const emptyInput = () => ({});
const handlerAsGiven = (handler) => handler;

/**
 * A group of HTTP routes under one scoped API base. Action routes name the
 * action they run, so the route table and static inspection both see it.
 * Keep the scope options and each actionRoute's method, suffix and actionId
 * literal (or a literal array's .map / for...of element) so inspectors can
 * read them without running the application.
 * @param {import("../../types.js").RuntimeHttp} http
 * @param {object} [scope]
 * @param {string} [scope.routeBase]
 * @param {string} [scope.relativePath]
 * @param {string} [scope.surface]
 * @param {boolean} [scope.strictParams]
 * @param {(handler: Function, route: { method: string, path: string, options: object }) => Function} [scope.wrapHandler] Wraps each route's handler; by default the handler is registered as given.
 */
function createActionRouteScope(
  http,
  {
    routeBase = "/",
    relativePath = "",
    surface = "",
    strictParams = false,
    wrapHandler = handlerAsGiven
  } = {}
) {
  const router = http?.router;
  // readable-check: allow method-probe - test asserts error: createActionRouteScope refuses a value that is not runtime.http
  if (!router || typeof router.register !== "function") {
    throw new RouteDefinitionError("createActionRouteScope requires runtime.http with router.register().");
  }
  // readable-check: allow method-probe - input validation: the application passes its own handler wrapper
  if (typeof wrapHandler !== "function") {
    throw new RouteDefinitionError("createActionRouteScope wrapHandler must be a function.");
  }

  const scopeBase = resolveScopedApiBasePath({ routeBase, relativePath, strictParams });
  const scopeSurface = normalizeSurfaceId(surface);

  function register(method, suffix, options, handler) {
    // readable-check: allow method-probe - input validation: the router sees only the wrapper, so the scope checks the route's own handler
    if (typeof handler !== "function") {
      throw new RouteDefinitionError(`Route ${method} ${scopeBase}${suffix} requires a handler function.`);
    }
    const path = `${scopeBase}${suffix}`;
    const routeOptions = { ...options, ...(scopeSurface ? { surface: scopeSurface } : {}) };
    router.register(method, path, routeOptions, wrapHandler(handler, { method, path, options: routeOptions }));
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
