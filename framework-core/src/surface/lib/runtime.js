import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";

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


function normalizeClientModuleRoute(route, { packageId, index }) {
  const candidate = route && typeof route === "object" && !Array.isArray(route) ? route : null;
  if (!candidate) {
    throw new Error(`Client route #${index} from ${packageId} must be an object.`);
  }

  const id = String(candidate.id || "").trim();
  const path = String(candidate.path || "").trim();
  if (!id) {
    throw new Error(`Client route #${index} from ${packageId} requires id.`);
  }
  if (!path || !path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Client route "${id}" from ${packageId} must have an absolute path starting with "/".`);
  }
  if (!candidate.component) {
    throw new Error(`Client route "${id}" from ${packageId} requires component.`);
  }

  const normalizedScope = String(
    candidate.scope ||
      (candidate.meta && candidate.meta.jskit && typeof candidate.meta.jskit === "object"
        ? candidate.meta.jskit.scope
        : "") ||
      "surface"
  )
    .trim()
    .toLowerCase();
  if (normalizedScope !== "global" && normalizedScope !== "surface") {
    throw new Error(`Client route "${id}" from ${packageId} has invalid scope "${normalizedScope}".`);
  }

  const normalizedSurface =
    normalizedScope === "surface"
      ? normalizeSurfaceId(
          candidate.surface ||
            (candidate.meta && candidate.meta.jskit && typeof candidate.meta.jskit === "object"
              ? candidate.meta.jskit.surface
              : "")
        ) || ""
      : "";

  const metaRecord =
    candidate.meta && typeof candidate.meta === "object" && !Array.isArray(candidate.meta) ? candidate.meta : {};
  const metaJskitRecord =
    metaRecord.jskit && typeof metaRecord.jskit === "object" && !Array.isArray(metaRecord.jskit)
      ? metaRecord.jskit
      : {};
  const normalizedMetaJskit = {
    ...metaJskitRecord,
    packageId,
    routeId: id,
    scope: normalizedScope
  };
  if (normalizedSurface) {
    normalizedMetaJskit.surface = normalizedSurface;
  }

  return Object.freeze({
    ...candidate,
    id,
    path,
    scope: normalizedScope,
    ...(normalizedSurface ? { surface: normalizedSurface } : {}),
    meta: {
      ...metaRecord,
      jskit: normalizedMetaJskit
    }
  });
}

function collectClientModuleRoutes({ clientModules = [] } = {}) {
  const entries = Array.isArray(clientModules) ? clientModules : [];
  const routes = [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const entry of entries) {
    const packageId = String(entry?.packageId || "").trim();
    if (!packageId) {
      throw new Error("collectClientModuleRoutes requires entry.packageId.");
    }

    const registerClientRoutes = entry?.module?.registerClientRoutes;
    if (typeof registerClientRoutes === "undefined") {
      continue;
    }
    if (typeof registerClientRoutes !== "function") {
      throw new Error(`Package ${packageId} exports registerClientRoutes but it is not a function.`);
    }

    let index = 0;
    const registerRoute = (route) => {
      index += 1;
      const normalizedRoute = normalizeClientModuleRoute(route, { packageId, index });
      if (seenIds.has(normalizedRoute.id)) {
        throw new Error(`Client route id "${normalizedRoute.id}" is duplicated.`);
      }
      if (seenPaths.has(normalizedRoute.path)) {
        throw new Error(`Client route path "${normalizedRoute.path}" is duplicated.`);
      }
      seenIds.add(normalizedRoute.id);
      seenPaths.add(normalizedRoute.path);
      routes.push(normalizedRoute);
    };

    const registerRoutes = (routeList) => {
      const items = Array.isArray(routeList) ? routeList : [];
      for (const route of items) {
        registerRoute(route);
      }
    };

    registerClientRoutes(Object.freeze({ packageId, registerRoute, registerRoutes }));
  }

  return Object.freeze([...routes]);
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

  function resolveRouteScope(route) {
    const metaScope =
      route && route.meta && route.meta.jskit && typeof route.meta.jskit === "object"
        ? route.meta.jskit.scope
        : "";
    const normalizedScope = String(route?.scope || metaScope || "surface")
      .trim()
      .toLowerCase();
    if (normalizedScope === "global") {
      return "global";
    }
    return "surface";
  }

  function resolveRouteSurface(route) {
    const metaSurface =
      route && route.meta && route.meta.jskit && typeof route.meta.jskit === "object"
        ? route.meta.jskit.surface
        : "";
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

export { createSurfaceRuntime, filterRoutesBySurface, collectClientModuleRoutes };
