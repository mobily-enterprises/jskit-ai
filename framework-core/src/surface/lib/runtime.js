import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";

const ROUTE_SCOPE_GLOBAL = "global";
const ROUTE_SCOPE_SURFACE = "surface";

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

function resolveSurfaceIds({ surfaceIds = [], surfaces = {} } = {}) {
  const fromOption = Array.isArray(surfaceIds) ? uniqueSurfaceIds(surfaceIds) : [];
  if (fromOption.length > 0) {
    return fromOption;
  }

  const fromSurfaces = uniqueSurfaceIds(Object.keys(surfaces || {}));
  if (fromSurfaces.length > 0) {
    return fromSurfaces;
  }

  throw new Error("createSurfaceRuntime requires at least one surface id.");
}

function createSurfaceRuntime(options = {}) {
  const allMode = normalizeSurfaceId(options?.allMode || "all") || "all";
  const sourceSurfaces = options?.surfaces && typeof options.surfaces === "object" ? options.surfaces : {};
  const surfaceIds = resolveSurfaceIds({
    surfaceIds: options?.surfaceIds,
    surfaces: sourceSurfaces
  });

  const normalizedSurfaces = Object.fromEntries(
    surfaceIds.map((surfaceId) => {
      const source = sourceSurfaces[surfaceId] || {};
      return [
        surfaceId,
        {
          id: surfaceId,
          prefix: source?.prefix,
          requiresWorkspace: Boolean(source?.requiresWorkspace),
          enabled: source?.enabled !== false
        }
      ];
    })
  );

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
    normalizeSurfaceMode,
    resolveSurfaceFromPathname: pathHelpers.resolveSurfaceFromPathname,
    listEnabledSurfaceIds,
    isSurfaceEnabled
  };
}

function normalizeRoutePath(pathValue) {
  const rawPath = String(pathValue || "").trim();
  if (!rawPath) {
    throw new Error("Client route path is required.");
  }
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    throw new Error(`Client route path must start with \"/\": ${rawPath}`);
  }
  return rawPath;
}

function normalizeRouteScope(scopeValue) {
  const normalized = String(scopeValue || ROUTE_SCOPE_SURFACE)
    .trim()
    .toLowerCase();
  if (normalized === ROUTE_SCOPE_GLOBAL || normalized === ROUTE_SCOPE_SURFACE) {
    return normalized;
  }
  throw new Error(`Client route scope must be \"${ROUTE_SCOPE_GLOBAL}\" or \"${ROUTE_SCOPE_SURFACE}\".`);
}

function normalizeRouteMeta(metaValue) {
  return metaValue && typeof metaValue === "object" && !Array.isArray(metaValue) ? { ...metaValue } : {};
}

function normalizeClientModuleRouteDefinition(routeDefinition, { packageId, routeIndex } = {}) {
  const route =
    routeDefinition && typeof routeDefinition === "object" && !Array.isArray(routeDefinition) ? routeDefinition : null;
  if (!route) {
    throw new Error(`Client route #${routeIndex} from ${packageId} must be an object.`);
  }

  const routeId = String(route.id || "").trim();
  if (!routeId) {
    throw new Error(`Client route #${routeIndex} from ${packageId} requires id.`);
  }

  const path = normalizeRoutePath(route.path);
  const scope = normalizeRouteScope(route.scope);
  const component = route.component;
  if (!component) {
    throw new Error(`Client route \"${routeId}\" from ${packageId} requires component.`);
  }

  const surface = scope === ROUTE_SCOPE_SURFACE ? normalizeSurfaceId(route.surface) : "";
  if (scope === ROUTE_SCOPE_SURFACE && !surface) {
    throw new Error(`Client route \"${routeId}\" from ${packageId} with scope \"surface\" requires surface.`);
  }

  const existingMeta = normalizeRouteMeta(route.meta);
  const existingJskitMeta = normalizeRouteMeta(existingMeta.jskit);

  return Object.freeze({
    ...route,
    id: routeId,
    path,
    scope,
    surface,
    meta: {
      ...existingMeta,
      jskit: {
        ...existingJskitMeta,
        packageId,
        routeId,
        scope,
        surface: surface || undefined
      }
    }
  });
}

function collectClientModuleRoutes({ clientModules = [] } = {}) {
  const entries = Array.isArray(clientModules) ? clientModules : [];
  const collectedRoutes = [];
  const seenRouteIds = new Set();
  const seenRoutePaths = new Set();

  for (const entry of entries) {
    const packageId = String(entry?.packageId || "").trim();
    if (!packageId) {
      throw new Error("collectClientModuleRoutes requires entry.packageId.");
    }

    const clientModule = entry?.module && typeof entry.module === "object" ? entry.module : {};
    const registerClientRoutes = clientModule.registerClientRoutes;
    if (typeof registerClientRoutes === "undefined") {
      continue;
    }
    if (typeof registerClientRoutes !== "function") {
      throw new Error(`Package ${packageId} exports registerClientRoutes but it is not a function.`);
    }

    let routeCounter = 0;
    const registerRoute = (routeDefinition) => {
      routeCounter += 1;
      const route = normalizeClientModuleRouteDefinition(routeDefinition, {
        packageId,
        routeIndex: routeCounter
      });

      if (seenRouteIds.has(route.id)) {
        throw new Error(`Client route id \"${route.id}\" is duplicated.`);
      }
      if (seenRoutePaths.has(route.path)) {
        throw new Error(`Client route path \"${route.path}\" is duplicated.`);
      }

      seenRouteIds.add(route.id);
      seenRoutePaths.add(route.path);
      collectedRoutes.push(route);
    };

    const registerRoutes = (routeDefinitions) => {
      const definitions = Array.isArray(routeDefinitions) ? routeDefinitions : [];
      for (const routeDefinition of definitions) {
        registerRoute(routeDefinition);
      }
    };

    registerClientRoutes(
      Object.freeze({
        packageId,
        registerRoute,
        registerRoutes
      })
    );
  }

  return Object.freeze([...collectedRoutes]);
}

function toRouteScopeMetadata(route) {
  const routeMeta = normalizeRouteMeta(route?.meta);
  const jskitMeta = normalizeRouteMeta(routeMeta.jskit);
  const scope = String(jskitMeta.scope || "")
    .trim()
    .toLowerCase();
  const surface = normalizeSurfaceId(jskitMeta.surface);
  return Object.freeze({
    scope,
    surface
  });
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

  return normalizedRoutes.filter((route) => {
    const scopeMetadata = toRouteScopeMetadata(route);
    if (scopeMetadata.scope === ROUTE_SCOPE_GLOBAL) {
      return true;
    }

    const routeSurface =
      scopeMetadata.scope === ROUTE_SCOPE_SURFACE && scopeMetadata.surface
        ? scopeMetadata.surface
        : surfaceRuntime.resolveSurfaceFromPathname(route?.path || "/");
    if (!enabledSurfaces.has(routeSurface)) {
      return false;
    }

    if (normalizedMode === allMode) {
      return true;
    }

    return routeSurface === normalizedMode;
  });
}

export { createSurfaceRuntime, filterRoutesBySurface, collectClientModuleRoutes };
