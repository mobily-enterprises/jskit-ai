import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueSurfaceIds(ids) {
  const seen = new Set();
  const ordered = [];
  for (const id of ids) {
    const normalizedId = normalizeSurfaceId(id);
    if (!normalizedId || seen.has(normalizedId)) {
      continue;
    }
    seen.add(normalizedId);
    ordered.push(normalizedId);
  }
  return ordered;
}

function resolveSurfaceIds({ surfaces = {} } = {}) {
  const surfaceCandidates = [];
  for (const [key, value] of Object.entries(isRecord(surfaces) ? surfaces : {})) {
    const record = isRecord(value) ? value : {};
    surfaceCandidates.push(record.id || key);
  }

  const fromSurfaces = uniqueSurfaceIds(surfaceCandidates);
  if (fromSurfaces.length > 0) {
    return fromSurfaces;
  }

  throw new Error("createSurfaceRuntime requires at least one surface id.");
}


function createSurfaceRuntime(options = {}) {
  const allMode = normalizeSurfaceId(options?.allMode || "all") || "all";
  const sourceSurfaces = isRecord(options?.surfaces) ? options.surfaces : {};
  const surfaceIds = resolveSurfaceIds({
    surfaces: sourceSurfaces
  });

  const normalizedSurfaces = {};
  for (const surfaceId of surfaceIds) {
    const source = isRecord(sourceSurfaces[surfaceId]) ? sourceSurfaces[surfaceId] : {};
    normalizedSurfaces[surfaceId] = {
      ...source,
      id: surfaceId,
      prefix: source.prefix,
      enabled: source.enabled !== false
    };
  }

  const defaultSurfaceId = normalizeSurfaceId(options?.defaultSurfaceId) || surfaceIds[0];
  const registry = createSurfaceRegistry({
    surfaces: normalizedSurfaces,
    defaultSurfaceId
  });

  const pathHelpers = createSurfacePathHelpers({
    apiBasePath: String(options?.apiBasePath || "/api"),
    defaultSurfaceId: registry.DEFAULT_SURFACE_ID,
    normalizeSurfaceId: registry.normalizeSurfaceId,
    resolveSurfacePrefix: registry.resolveSurfacePrefix,
    listSurfaceDefinitions: registry.listSurfaceDefinitions,
    routes: options?.routes
  });

  const enabledSurfaceIds = surfaceIds.filter((surfaceId) => normalizedSurfaces[surfaceId]?.enabled !== false);
  const defaultSurfaceSource = isRecord(normalizedSurfaces[registry.DEFAULT_SURFACE_ID])
    ? normalizedSurfaces[registry.DEFAULT_SURFACE_ID]
    : {};
  const defaultSurfaceDefinition = Object.freeze({
    ...defaultSurfaceSource
  });

  function normalizeSurfaceMode(value) {
    const normalized = normalizeSurfaceId(value);
    if (!normalized || normalized === allMode) {
      return allMode;
    }

    return registry.SURFACE_REGISTRY[normalized] ? normalized : allMode;
  }

  function listEnabledSurfaceIds() {
    return [...enabledSurfaceIds];
  }

  function getSurfaceDefinition(surfaceId) {
    const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
    const definition = normalizedSurfaces[normalizedSurfaceId];
    if (!definition) {
      return null;
    }

    return Object.freeze({
      ...definition
    });
  }

  function listSurfaceDefinitions({ enabledOnly = false } = {}) {
    const ids = enabledOnly ? enabledSurfaceIds : surfaceIds;
    const definitions = [];
    for (const surfaceId of ids) {
      const source = isRecord(normalizedSurfaces[surfaceId]) ? normalizedSurfaces[surfaceId] : {};
      definitions.push(
        Object.freeze({
          ...source
        })
      );
    }
    return definitions;
  }

  function isSurfaceEnabled(surfaceId) {
    const normalizedSurface = normalizeSurfaceMode(surfaceId);
    if (normalizedSurface === allMode) {
      return false;
    }

    return enabledSurfaceIds.includes(normalizedSurface);
  }

  return {
    SURFACE_MODE_ALL: allMode,
    SURFACE_IDS: [...surfaceIds],
    DEFAULT_SURFACE_ID: registry.DEFAULT_SURFACE_ID,
    DEFAULT_SURFACE: defaultSurfaceDefinition,
    normalizeSurfaceMode,
    resolveSurfaceFromPathname: pathHelpers.resolveSurfaceFromPathname,
    getSurfaceDefinition,
    listSurfaceDefinitions,
    listEnabledSurfaceIds,
    isSurfaceEnabled
  };
}


function filterRoutesBySurface(routeList, { surfaceRuntime, surfaceMode } = {}) {
  if (!surfaceRuntime || typeof surfaceRuntime !== "object") {
    throw new Error("filterRoutesBySurface requires surfaceRuntime.");
  }
  if (typeof surfaceRuntime.normalizeSurfaceMode !== "function") {
    throw new Error("filterRoutesBySurface requires surfaceRuntime.normalizeSurfaceMode().");
  }
  if (typeof surfaceRuntime.resolveSurfaceFromPathname !== "function") {
    throw new Error("filterRoutesBySurface requires surfaceRuntime.resolveSurfaceFromPathname().");
  }
  if (typeof surfaceRuntime.listEnabledSurfaceIds !== "function") {
    throw new Error("filterRoutesBySurface requires surfaceRuntime.listEnabledSurfaceIds().");
  }

  const normalizedRoutes = Array.isArray(routeList) ? routeList : [];
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  const normalizedMode = surfaceRuntime.normalizeSurfaceMode(surfaceMode);
  const enabledSurfaces = new Set(surfaceRuntime.listEnabledSurfaceIds());

  function readRouteJskitMeta(route) {
    if (!isRecord(route) || !isRecord(route.meta) || !isRecord(route.meta.jskit)) {
      return {};
    }
    return route.meta.jskit;
  }

  function resolveOwnRouteScope(route) {
    const metaScope = readRouteJskitMeta(route).scope;
    const normalizedScope = String(route?.scope || metaScope || "")
      .trim()
      .toLowerCase();
    if (!normalizedScope) {
      return "";
    }
    return normalizedScope === "global" ? "global" : "surface";
  }

  function routeTreeHasGlobalScope(route) {
    if (resolveOwnRouteScope(route) === "global") {
      return true;
    }

    const children = Array.isArray(route?.children) ? route.children : [];
    for (const child of children) {
      if (routeTreeHasGlobalScope(child)) {
        return true;
      }
    }

    return false;
  }

  function resolveRouteScope(route) {
    const ownScope = resolveOwnRouteScope(route);
    if (ownScope) {
      return ownScope;
    }
    return routeTreeHasGlobalScope(route) ? "global" : "surface";
  }

  function resolveRouteSurface(route) {
    const metaSurface = readRouteJskitMeta(route).surface;
    const normalizedSurface = normalizeSurfaceId(route?.surface || metaSurface);
    if (normalizedSurface) {
      return normalizedSurface;
    }
    return surfaceRuntime.resolveSurfaceFromPathname(route?.path || "/");
  }

  return normalizedRoutes.filter((route) => {
    if (resolveRouteScope(route) === "global") {
      return true;
    }

    const routeSurface = resolveRouteSurface(route);
    if (!enabledSurfaces.has(routeSurface)) {
      return false;
    }

    if (normalizedMode === allMode) {
      return true;
    }

    return routeSurface === normalizedMode;
  });
}

export {
  createSurfaceRuntime,
  filterRoutesBySurface
};
