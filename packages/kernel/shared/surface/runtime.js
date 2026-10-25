import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";
import { isRecord } from "../support/normalize.js";

// Unlike normalizePathname, this keeps "?" so vue-router optional params
// such as "/users/:id?" survive when a route is hoisted to an absolute path.
function normalizeRoutePath(pathLike = "") {
  const rawPath = String(pathLike || "").trim();
  if (!rawPath || rawPath === "/") {
    return "/";
  }

  const withLeadingSlash = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  return compacted.replace(/\/+$/, "") || "/";
}

function resolveAbsoluteRoutePath(parentAbsolutePath = "/", routePath = "") {
  const normalizedParentPath = normalizeRoutePath(parentAbsolutePath);
  const rawRoutePath = String(routePath || "").trim();
  if (!rawRoutePath) {
    return normalizedParentPath;
  }
  if (rawRoutePath.startsWith("/")) {
    return normalizeRoutePath(rawRoutePath);
  }
  if (normalizedParentPath === "/") {
    return normalizeRoutePath(`/${rawRoutePath}`);
  }
  return normalizeRoutePath(`${normalizedParentPath}/${rawRoutePath}`);
}

function readRouteJskitMeta(route) {
  if (!isRecord(route) || !isRecord(route.meta) || !isRecord(route.meta.jskit)) {
    return {};
  }
  return route.meta.jskit;
}

function resolveRouteExplicitSurface(route) {
  const metaSurface = readRouteJskitMeta(route).surface;
  return normalizeSurfaceId(route?.surface || metaSurface);
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

function resolveRouteSurface(route, inheritedSurfaceId = "", { surfaceRuntime, absolutePath = "/" } = {}) {
  const explicitSurface = resolveRouteExplicitSurface(route);
  if (explicitSurface) {
    return explicitSurface;
  }

  const normalizedInheritedSurface = normalizeSurfaceId(inheritedSurfaceId);
  if (normalizedInheritedSurface) {
    return normalizedInheritedSurface;
  }

  return surfaceRuntime.resolveSurfaceFromPathname(absolutePath);
}

function normalizeRoutesBySurfaceBoundaries(routeList = [], { surfaceRuntime } = {}) {
  const normalizedRoutes = Array.isArray(routeList) ? routeList : [];
  const hoistedRoutes = [];

  function cloneRouteWithChildren(route, children) {
    const nextRoute = {
      ...route
    };
    if (children.length > 0) {
      nextRoute.children = children;
    } else if (Object.prototype.hasOwnProperty.call(nextRoute, "children")) {
      delete nextRoute.children;
    }
    return nextRoute;
  }

  function cloneRouteAsHoisted(route, absolutePath, children) {
    const nextRoute = cloneRouteWithChildren(route, children);
    nextRoute.path = absolutePath;
    return nextRoute;
  }

  function visitRoute(route, parentSurfaceId = "", parentAbsolutePath = "/") {
    if (!isRecord(route)) {
      return null;
    }

    const absolutePath = resolveAbsoluteRoutePath(parentAbsolutePath, route.path);
    const explicitSurface = resolveRouteExplicitSurface(route);
    const normalizedParentSurfaceId = normalizeSurfaceId(parentSurfaceId);
    const resolvedSurface = resolveRouteSurface(route, normalizedParentSurfaceId, {
      surfaceRuntime,
      absolutePath
    });
    const surfaceBoundary =
      Boolean(explicitSurface) &&
      Boolean(normalizedParentSurfaceId) &&
      explicitSurface !== normalizedParentSurfaceId;

    const children = Array.isArray(route.children) ? route.children : [];
    const filteredChildren = [];
    for (const child of children) {
      const normalizedChild = visitRoute(child, resolvedSurface, absolutePath);
      if (normalizedChild) {
        filteredChildren.push(normalizedChild);
      }
    }

    const shouldCloneForChildren =
      children.length !== filteredChildren.length ||
      filteredChildren.some((child, index) => child !== children[index]);
    const routeWithChildren = shouldCloneForChildren ? cloneRouteWithChildren(route, filteredChildren) : route;

    if (!surfaceBoundary) {
      return routeWithChildren;
    }

    hoistedRoutes.push(cloneRouteAsHoisted(routeWithChildren, absolutePath, filteredChildren));
    return null;
  }

  const keptRoutes = [];
  for (const route of normalizedRoutes) {
    const normalizedRoute = visitRoute(route, "", "/");
    if (normalizedRoute) {
      keptRoutes.push(normalizedRoute);
    }
  }

  return [...keptRoutes, ...hoistedRoutes];
}


function createSurfaceRuntime(options = {}) {
  const allMode = normalizeSurfaceId(options?.allMode || "all") || "all";
  const registry = createSurfaceRegistry({
    surfaces: isRecord(options?.surfaces) ? options.surfaces : {},
    defaultSurfaceId: options?.defaultSurfaceId
  });
  const { SURFACE_REGISTRY, DEFAULT_SURFACE_ID } = registry;
  const surfaceDefinitions = registry.listSurfaceDefinitions();
  const surfaceIds = surfaceDefinitions.map((definition) => definition.id);
  const enabledSurfaceIds = surfaceDefinitions.filter((definition) => definition.enabled).map((definition) => definition.id);

  const pathHelpers = createSurfacePathHelpers({
    apiBasePath: options?.apiBasePath,
    defaultSurfaceId: DEFAULT_SURFACE_ID,
    surfaceDefinitions
  });

  function normalizeSurfaceMode(value) {
    const normalized = normalizeSurfaceId(value);
    if (!normalized || normalized === allMode) {
      return allMode;
    }

    return SURFACE_REGISTRY[normalized] ? normalized : allMode;
  }

  function listEnabledSurfaceIds() {
    return [...enabledSurfaceIds];
  }

  function getSurfaceDefinition(surfaceId) {
    return SURFACE_REGISTRY[normalizeSurfaceId(surfaceId)] || null;
  }

  function listSurfaceDefinitions({ enabledOnly = false } = {}) {
    return enabledOnly ? surfaceDefinitions.filter((definition) => definition.enabled) : [...surfaceDefinitions];
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
    DEFAULT_SURFACE_ID,
    DEFAULT_SURFACE: SURFACE_REGISTRY[DEFAULT_SURFACE_ID],
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

  const normalizedRoutes = normalizeRoutesBySurfaceBoundaries(routeList, {
    surfaceRuntime
  });
  const allMode = String(surfaceRuntime.SURFACE_MODE_ALL || "all").trim().toLowerCase() || "all";
  const normalizedMode = surfaceRuntime.normalizeSurfaceMode(surfaceMode);
  const enabledSurfaces = new Set(surfaceRuntime.listEnabledSurfaceIds());

  function filterRouteNode(route, inheritedSurfaceId = "") {
    if (!isRecord(route)) {
      return null;
    }

    const resolvedSurface = resolveRouteSurface(route, inheritedSurfaceId, {
      surfaceRuntime,
      absolutePath: String(route.path || "/")
    });
    const isGlobalScope = resolveOwnRouteScope(route) === "global";
    const isEnabledSurfaceRoute = enabledSurfaces.has(resolvedSurface);
    const ownIncluded =
      isGlobalScope ||
      (isEnabledSurfaceRoute && (normalizedMode === allMode || resolvedSurface === normalizedMode));

    const children = Array.isArray(route.children) ? route.children : [];
    const filteredChildren = children
      .map((child) => filterRouteNode(child, resolvedSurface))
      .filter(Boolean);

    if (!ownIncluded && filteredChildren.length < 1) {
      return null;
    }

    if (children.length < 1) {
      return route;
    }

    return {
      ...route,
      children: filteredChildren
    };
  }

  return normalizedRoutes.map((route) => filterRouteNode(route)).filter(Boolean);
}

export {
  createSurfaceRuntime,
  filterRoutesBySurface
};
