import { normalizeObject } from "../../shared/support/normalize.js";
import { normalizeSurfaceId } from "../../shared/surface/registry.js";

function resolveAppConfig(scope = null) {
  const source = scope && typeof scope === "object" ? scope : null;
  if (!source || typeof source.has !== "function" || typeof source.make !== "function") {
    return {};
  }
  if (!source.has("appConfig")) {
    return {};
  }

  return normalizeObject(source.make("appConfig"));
}

function normalizeDefaultSurfaceId(value, { fallback = "" } = {}) {
  const normalizedValue = normalizeSurfaceId(value);
  if (normalizedValue) {
    return normalizedValue;
  }

  const normalizedFallback = normalizeSurfaceId(fallback);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return "";
}

function resolveDefaultSurfaceId(scope = null, { defaultSurfaceId = "" } = {}) {
  const appConfig = resolveAppConfig(scope);
  return normalizeDefaultSurfaceId(defaultSurfaceId, {
    fallback: appConfig.surfaceDefaultId
  });
}

export { resolveAppConfig, normalizeDefaultSurfaceId, resolveDefaultSurfaceId };
