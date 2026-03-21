import { normalizeObject } from "../support/normalize.js";

function normalizeSurfaceId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeSurfacePagesRoot(pagesRootLike) {
  const rawPagesRoot = String(pagesRootLike || "").trim();
  if (!rawPagesRoot || rawPagesRoot === "/") {
    return "";
  }

  return rawPagesRoot
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function normalizeRouteSegment(segmentLike) {
  const segment = String(segmentLike || "").trim();
  if (!segment) {
    return "";
  }

  const dynamicMatch = segment.match(/^\[([^\]]+)\]$/);
  if (dynamicMatch) {
    const paramName = String(dynamicMatch[1] || "").trim();
    if (!paramName) {
      return "";
    }
    return `:${paramName}`;
  }

  return segment;
}

function deriveSurfaceRouteBaseFromPagesRoot(pagesRootLike) {
  const normalizedPagesRoot = normalizeSurfacePagesRoot(pagesRootLike);
  if (!normalizedPagesRoot) {
    return "/";
  }

  const segments = normalizedPagesRoot
    .split("/")
    .map((segment) => normalizeRouteSegment(segment))
    .filter(Boolean);

  if (segments.length < 1) {
    return "/";
  }
  return `/${segments.join("/")}`;
}

function createSurfaceRegistry(options = {}) {
  const rawSurfaces = options?.surfaces;
  if (!rawSurfaces || typeof rawSurfaces !== "object") {
    throw new Error("createSurfaceRegistry requires a surfaces object.");
  }

  const normalizedEntries = Object.entries(rawSurfaces)
    .map(([key, value]) => {
      const sourceDefinition = normalizeObject(value);
      const normalizedId = normalizeSurfaceId(sourceDefinition.id || key);
      if (!normalizedId) {
        return null;
      }

      const pagesRoot = normalizeSurfacePagesRoot(sourceDefinition.pagesRoot);
      if (
        !Object.prototype.hasOwnProperty.call(sourceDefinition, "pagesRoot") &&
        pagesRoot === ""
      ) {
        throw new Error(`Surface "${normalizedId}" requires pagesRoot (use "" for root).`);
      }

      return [
        normalizedId,
        Object.freeze({
          ...sourceDefinition,
          id: normalizedId,
          pagesRoot,
          routeBase: deriveSurfaceRouteBaseFromPagesRoot(pagesRoot)
        })
      ];
    })
    .filter(Boolean);

  if (normalizedEntries.length < 1) {
    throw new Error("createSurfaceRegistry requires at least one surface definition.");
  }

  const SURFACE_REGISTRY = Object.freeze(Object.fromEntries(normalizedEntries));
  const fallbackSurfaceId = normalizedEntries[0][0];
  const requestedDefaultSurfaceId = normalizeSurfaceId(options?.defaultSurfaceId);
  const DEFAULT_SURFACE_ID = SURFACE_REGISTRY[requestedDefaultSurfaceId]
    ? requestedDefaultSurfaceId
    : fallbackSurfaceId;

  function normalizeRegisteredSurfaceId(value) {
    const normalized = normalizeSurfaceId(value);
    if (SURFACE_REGISTRY[normalized]) {
      return normalized;
    }

    return DEFAULT_SURFACE_ID;
  }

  function resolveSurfacePagesRoot(surfaceId) {
    return SURFACE_REGISTRY[normalizeRegisteredSurfaceId(surfaceId)]?.pagesRoot || "";
  }

  function resolveSurfaceRouteBase(surfaceId) {
    return SURFACE_REGISTRY[normalizeRegisteredSurfaceId(surfaceId)]?.routeBase || "/";
  }

  function listSurfaceDefinitions() {
    return Object.values(SURFACE_REGISTRY);
  }

  return Object.freeze({
    SURFACE_REGISTRY,
    DEFAULT_SURFACE_ID,
    normalizeSurfaceId: normalizeRegisteredSurfaceId,
    resolveSurfacePagesRoot,
    resolveSurfaceRouteBase,
    listSurfaceDefinitions
  });
}

export {
  createSurfaceRegistry,
  normalizeSurfaceId,
  normalizeSurfacePagesRoot,
  deriveSurfaceRouteBaseFromPagesRoot
};
