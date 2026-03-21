import { normalizeObject } from "../../shared/support/normalize.js";
import { normalizeSurfaceId } from "../../shared/surface/registry.js";

const DEFAULT_KERNEL_SURFACE_ID = "public";

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

function normalizeDefaultSurfaceId(value, { fallback = DEFAULT_KERNEL_SURFACE_ID } = {}) {
  const normalizedValue = normalizeSurfaceId(value);
  if (normalizedValue) {
    return normalizedValue;
  }

  const normalizedFallback = normalizeSurfaceId(fallback);
  if (normalizedFallback) {
    return normalizedFallback;
  }

  return DEFAULT_KERNEL_SURFACE_ID;
}

function resolveDefaultSurfaceId(scope = null, { defaultSurfaceId = "" } = {}) {
  const appConfig = resolveAppConfig(scope);
  return normalizeDefaultSurfaceId(defaultSurfaceId, {
    fallback: appConfig.surfaceDefaultId
  });
}

export { DEFAULT_KERNEL_SURFACE_ID, resolveAppConfig, normalizeDefaultSurfaceId, resolveDefaultSurfaceId };
