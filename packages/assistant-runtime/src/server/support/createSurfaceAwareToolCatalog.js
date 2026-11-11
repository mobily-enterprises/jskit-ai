import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAssistantServerConfig } from "./assistantServerConfig.js";

function buildCatalogOptions(appConfig = {}, surfaceId = "") {
  const surfaceConfig = resolveAssistantServerConfig(appConfig, surfaceId);

  return Object.freeze({
    barredActionIds: surfaceConfig.barredActionIds || [],
    skipActionPrefixes: Object.freeze(["assistant.", ...(surfaceConfig.toolSkipActionPrefixes || [])]),
    ...(surfaceConfig.maxToolArgumentBytes ? { maxToolArgumentBytes: surfaceConfig.maxToolArgumentBytes } : {}),
    ...(surfaceConfig.maxToolResultBytes ? { maxToolResultBytes: surfaceConfig.maxToolResultBytes } : {})
  });
}

function requireContextSurfaceId(context) {
  const surfaceId = normalizeSurfaceId(context?.surface);
  if (surfaceId) {
    return surfaceId;
  }

  throw new Error("assistant surface-aware tool catalog requires context.surface.");
}

/**
 * The assistant's tool catalogue over an application's actions, resolved per surface. Each surface
 * offers the actions its `assistantServer` configuration leaves in (its barred action ids and
 * skipped prefixes taken out), and its tool sets carry its limits, `maxToolArgumentBytes` and
 * `maxToolResultBytes` included, which its calls are held to. Every call names its surface in
 * `context.surface`. The assistant runtime builds its catalogue this way; an application test builds
 * one the same way to see the tools a surface offers and to call them.
 * @param {import("@jskit-ai/kernel/server/types").ActionCatalogue} actions The application's actions (`runtime.actions`).
 * @param {object} [options]
 * @param {Record<string, any>} [options.appConfig] The server configuration that holds `assistantServer`.
 * @param {typeof createServiceToolCatalog} [options.createCatalog]
 */
function createSurfaceAwareToolCatalog(actions, { appConfig = {}, createCatalog = createServiceToolCatalog } = {}) {
  // readable-check: allow method-probe - input validation: an application hands over its action catalogue
  if (!actions || typeof actions.listDefinitions !== "function") {
    throw new Error("createSurfaceAwareToolCatalog requires runtime.actions.");
  }

  const normalizedAppConfig = normalizeObject(appConfig);
  const cache = new Map();
  let schemaCatalog = null;

  function resolveCatalog(surfaceId = "") {
    if (cache.has(surfaceId)) {
      return cache.get(surfaceId);
    }

    const nextCatalog = createCatalog(actions, buildCatalogOptions(normalizedAppConfig, surfaceId));
    cache.set(surfaceId, nextCatalog);
    return nextCatalog;
  }

  function resolveToolSet(context = {}, options) {
    const surfaceId = requireContextSurfaceId(context);
    return resolveCatalog(surfaceId).resolveToolSet(context, options);
  }

  function toOpenAiToolSchema(tool) {
    if (!schemaCatalog) {
      schemaCatalog = createCatalog(actions, buildCatalogOptions(normalizedAppConfig, ""));
    }

    return schemaCatalog.toOpenAiToolSchema(tool);
  }

  function executeToolCall(payload = {}) {
    const context = payload.context && typeof payload.context === "object" ? payload.context : {};
    const surfaceId = requireContextSurfaceId(context);
    return resolveCatalog(surfaceId).executeToolCall(payload);
  }

  return Object.freeze({
    resolveToolSet,
    toOpenAiToolSchema,
    executeToolCall
  });
}

export { createSurfaceAwareToolCatalog };
