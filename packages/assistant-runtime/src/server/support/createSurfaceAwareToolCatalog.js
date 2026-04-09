import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAssistantServerConfig } from "./assistantServerConfig.js";

function buildCatalogOptions(appConfig = {}, surfaceId = "") {
  const surfaceConfig = resolveAssistantServerConfig(appConfig, surfaceId);

  return Object.freeze({
    barredActionIds: surfaceConfig.barredActionIds || [],
    skipActionPrefixes: Object.freeze(["assistant.", ...(surfaceConfig.toolSkipActionPrefixes || [])])
  });
}

function requireContextSurfaceId(context = {}) {
  const surfaceId = normalizeSurfaceId(context?.surface);
  if (surfaceId) {
    return surfaceId;
  }

  throw new Error("assistant surface-aware tool catalog requires context.surface.");
}

function createSurfaceAwareToolCatalog(scope, { appConfig = {}, resolveAppConfig = null, createCatalog = createServiceToolCatalog } = {}) {
  if (!scope) {
    throw new Error("createSurfaceAwareToolCatalog requires scope.");
  }

  const resolveCurrentAppConfig =
    typeof resolveAppConfig === "function" ? () => normalizeObject(resolveAppConfig()) : () => normalizeObject(appConfig);
  const cache = new Map();
  let schemaCatalog = null;

  function resolveCatalog(surfaceId = "") {
    if (cache.has(surfaceId)) {
      return cache.get(surfaceId);
    }

    const nextCatalog = createCatalog(scope, buildCatalogOptions(resolveCurrentAppConfig(), surfaceId));
    cache.set(surfaceId, nextCatalog);
    return nextCatalog;
  }

  return Object.freeze({
    resolveToolSet(context = {}) {
      const surfaceId = requireContextSurfaceId(context);
      return resolveCatalog(surfaceId).resolveToolSet(context);
    },
    toOpenAiToolSchema(tool) {
      if (!schemaCatalog) {
        schemaCatalog = createCatalog(scope, buildCatalogOptions(resolveCurrentAppConfig(), ""));
      }

      return schemaCatalog.toOpenAiToolSchema(tool);
    },
    executeToolCall(payload = {}) {
      const context = payload?.context && typeof payload.context === "object" ? payload.context : {};
      const surfaceId = requireContextSurfaceId(context);
      return resolveCatalog(surfaceId).executeToolCall(payload);
    }
  });
}

export { createSurfaceAwareToolCatalog };
