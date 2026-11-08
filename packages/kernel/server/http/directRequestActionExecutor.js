import { normalizeLowerText, normalizeObject } from "../../shared/support/normalize.js";
import { normalizeRouteVisibilityToken } from "../../shared/support/visibility.js";
import { normalizeSurfaceId } from "../../shared/surface/registry.js";

/** @typedef {import("../types.js").ActionCatalogue} ActionCatalogue */

function resolveSurface(request, explicitSurface, defaultSurfaceId) {
  return (
    normalizeSurfaceId(explicitSurface) ||
    normalizeSurfaceId(request.routeOptions?.config?.surface) ||
    normalizeSurfaceId(request.surface) ||
    normalizeSurfaceId(defaultSurfaceId)
  );
}

function routeVisibility(request, payload) {
  const routeConfig = normalizeObject(request.routeOptions?.config);
  return normalizeRouteVisibilityToken(
    Object.hasOwn(routeConfig, "visibility")
      ? routeConfig.visibility
      : payload.visibility
  );
}

/**
 * Gives a route's request `executeAction(payload)`, which runs an action in the request's context, and
 * `callOptions({ input })`, the call options `{ context }` the same request's action would get, for a route that
 * reads or writes its own tables without one: the same context contributors resolve its user, workspace and
 * visibility. `input` is what the contributors read (a workspace route's `workspaceSlug`), the route's params by
 * default. A request that already has them keeps them.
 * @param {object} options
 * @param {ActionCatalogue} options.actions
 * @param {any} options.request The request to give them; anything else is left alone.
 * @param {string} [options.defaultChannel]
 * @param {string} [options.defaultSurfaceId]
 */
function attachDirectRequestActionExecutor({
  actions,
  request,
  defaultChannel = "api",
  defaultSurfaceId = ""
}) {
  if (!request || typeof request !== "object") {
    return null;
  }

  // The context an action of this request starts from, before the context contributors add theirs.
  const requestContext = (source) => Object.freeze({
    ...normalizeObject(source.context),
    channel: normalizeLowerText(source.channel) || defaultChannel,
    surface: resolveSurface(request, source.surface, defaultSurfaceId),
    routeVisibility: routeVisibility(request, source),
    requestMeta: Object.freeze({
      ...normalizeObject(source.context?.requestMeta),
      request
    })
  });

  const executeAction = async (payload = {}) => {
    const source = normalizeObject(payload);
    const actionId = source.actionId;
    const version = source.version == null ? null : source.version;
    const definition = actions.getDefinition(actionId, version);
    const execute = definition.kind === "stream" ? actions.executeStream : actions.execute;
    return execute({
      actionId,
      version,
      input: normalizeObject(source.input),
      context: requestContext(source),
      deps: normalizeObject(source.deps)
    });
  };

  const callOptions = async ({ input = request.params } = {}) => Object.freeze({
    context: await actions.contextFor({ input: normalizeObject(input), context: requestContext({}) })
  });

  // readable-check: allow method-probe - platform object: a request that already has call options keeps them
  if (typeof request.callOptions !== "function") {
    Object.defineProperty(request, "callOptions", { configurable: true, enumerable: false, writable: true, value: callOptions });
  }
  // readable-check: allow method-probe - platform object: a request that already has an executor keeps it
  if (typeof request.executeAction === "function") {
    return request.executeAction;
  }
  Object.defineProperty(request, "executeAction", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: executeAction
  });
  return executeAction;
}

export { attachDirectRequestActionExecutor };
