import { normalizeObject, normalizeText } from "../../shared/support/normalize.js";
import { normalizeRouteVisibilityToken } from "../../shared/support/visibility.js";
import { resolveDefaultSurfaceId } from "../support/appConfig.js";

/** @typedef {import("../types.js").ActionCatalogue} ActionCatalogue */

function resolveSurface(request, explicitSurface = "", defaultSurfaceId = "") {
  return (
    normalizeText(explicitSurface).toLowerCase() ||
    normalizeText(request?.routeOptions?.config?.surface).toLowerCase() ||
    normalizeText(request?.surface).toLowerCase() ||
    resolveDefaultSurfaceId(null, { defaultSurfaceId })
  );
}

function routeVisibility(request, payload = {}) {
  const routeConfig = normalizeObject(request?.routeOptions?.config);
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
 * @param {string} [options.property]
 * @param {string} [options.defaultChannel]
 * @param {string} [options.defaultSurfaceId]
 */
function attachDirectRequestActionExecutor({
  actions,
  request,
  property = "executeAction",
  defaultChannel = "api",
  defaultSurfaceId = ""
}) {
  if (!request || typeof request !== "object") {
    return null;
  }
  const propertyName = normalizeText(property) || "executeAction";
  // readable-check: allow method-probe - platform object: a request that already has an executor keeps it
  if (typeof request[propertyName] === "function") {
    return request[propertyName];
  }

  const executeAction = async (payload = {}) => {
    const source = normalizeObject(payload);
    const channel = normalizeText(source.channel || defaultChannel).toLowerCase() || "api";
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

  Object.defineProperty(request, propertyName, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: executeAction
  });
  return executeAction;
}

export { attachDirectRequestActionExecutor };
