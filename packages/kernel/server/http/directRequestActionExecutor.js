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
 * @param {object} options
 * @param {ActionCatalogue} options.actions
 * @param {any} options.request The request to give an executeAction(); anything else is left alone.
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
  // readable-check: allow method-probe - platform object: a request that already has an executor keeps it
  if (typeof request.executeAction === "function") {
    return request.executeAction;
  }

  const executeAction = async (payload = {}) => {
    const source = normalizeObject(payload);
    const channel = normalizeLowerText(source.channel) || defaultChannel;
    const context = Object.freeze({
      ...normalizeObject(source.context),
      channel,
      surface: resolveSurface(request, source.surface, defaultSurfaceId),
      routeVisibility: routeVisibility(request, source),
      requestMeta: Object.freeze({
        ...normalizeObject(source.context?.requestMeta),
        request
      })
    });

    const actionId = source.actionId;
    const version = source.version == null ? null : source.version;
    const definition = actions.getDefinition(actionId, version);
    const execute = definition.kind === "stream" ? actions.executeStream : actions.execute;
    return execute({
      actionId,
      version,
      input: normalizeObject(source.input),
      context,
      deps: normalizeObject(source.deps)
    });
  };

  Object.defineProperty(request, "executeAction", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: executeAction
  });
  return executeAction;
}

export { attachDirectRequestActionExecutor };
