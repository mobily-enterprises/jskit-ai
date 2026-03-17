import { createSurfacePathHelpers } from "./paths.js";
import { createSurfaceRegistry, normalizeSurfaceId } from "./registry.js";

const TENANCY_MODE_NONE = "none";
const TENANCY_MODE_PERSONAL = "personal";
const TENANCY_MODE_WORKSPACE = "workspace";
const TENANCY_MODES = Object.freeze([TENANCY_MODE_NONE, TENANCY_MODE_PERSONAL, TENANCY_MODE_WORKSPACE]);

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
  const fromSurfaces = uniqueSurfaceIds(
    Object.entries(surfaces || {}).map(([key, value]) => {
      const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      return record.id || key;
    })
  );
  if (fromSurfaces.length > 0) {
    return fromSurfaces;
  }

  throw new Error("createSurfaceRuntime requires at least one surface id.");
}

function normalizeTenancyMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!TENANCY_MODES.includes(normalized)) {
    return TENANCY_MODE_NONE;
  }
  return normalized;
}

function validateTenancyModeAgainstSurfaces({ tenancyMode, enabledSurfaceIds = [], normalizedSurfaces = {} } = {}) {
  const workspaceEnabledSurfaceIds = enabledSurfaceIds.filter(
    (surfaceId) => Boolean(normalizedSurfaces[surfaceId]?.requiresWorkspace)
  );

  if (tenancyMode === TENANCY_MODE_NONE && workspaceEnabledSurfaceIds.length > 0) {
    throw new Error(
      `createSurfaceRuntime invalid config: tenancyMode "${TENANCY_MODE_NONE}" cannot enable workspace surfaces (${workspaceEnabledSurfaceIds.join(", ")}).`
    );
  }

  if (tenancyMode !== TENANCY_MODE_NONE && workspaceEnabledSurfaceIds.length < 1) {
    throw new Error(
      `createSurfaceRuntime invalid config: tenancyMode "${tenancyMode}" requires at least one enabled workspace surface.`
    );
  }
}

function normalizeWorkspaceSurfacePolicy(policy = {}) {
  const source = policy && typeof policy === "object" && !Array.isArray(policy) ? policy : {};
  const preferredSurfaceIds = uniqueSurfaceIds(
    Array.isArray(source.preferredSurfaceIds) ? source.preferredSurfaceIds : []
  );

  return {
    preferredSurfaceIds,
    ensureAtLeastOneWorkspaceSurface: source.ensureAtLeastOneWorkspaceSurface !== false
  };
}

function applyWorkspaceSurfacePolicyToSurfaces({ surfaces = {}, policy = {} } = {}) {
  const sourceSurfaces = surfaces && typeof surfaces === "object" && !Array.isArray(surfaces) ? surfaces : {};
  const normalizedPolicy = normalizeWorkspaceSurfacePolicy(policy);
  const entries = Object.entries(sourceSurfaces).map(([key, value]) => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const surfaceId = normalizeSurfaceId(record.id || key);
    return { key, surfaceId, record };
  });
  const nextSurfaces = new Map(entries.map(({ key, record }) => [key, { ...record }]));
  const enabledEntries = entries.filter(
    ({ key, surfaceId }) => Boolean(surfaceId) && nextSurfaces.get(key)?.enabled !== false
  );

  for (const surfaceId of normalizedPolicy.preferredSurfaceIds) {
    const matchedEntry = enabledEntries.find((entry) => entry.surfaceId === surfaceId);
    if (!matchedEntry) {
      continue;
    }
    const matchedSurface = nextSurfaces.get(matchedEntry.key);
    if (matchedSurface) {
      matchedSurface.requiresWorkspace = true;
    }
  }

  const hasWorkspaceSurface = enabledEntries.some(({ key }) => nextSurfaces.get(key)?.requiresWorkspace === true);
  if (!hasWorkspaceSurface && normalizedPolicy.ensureAtLeastOneWorkspaceSurface && enabledEntries.length > 0) {
    const [firstEnabledEntry] = enabledEntries;
    const firstEnabledSurface = nextSurfaces.get(firstEnabledEntry.key);
    if (firstEnabledSurface) {
      firstEnabledSurface.requiresWorkspace = true;
    }
  }

  return Object.fromEntries(entries.map(({ key }) => [key, nextSurfaces.get(key) || {}]));
}

function createSurfaceRuntime(options = {}) {
  const allMode = normalizeSurfaceId(options?.allMode || "all") || "all";
  const tenancyMode = normalizeTenancyMode(options?.tenancyMode);
  const sourceSurfaces = options?.surfaces && typeof options.surfaces === "object" ? options.surfaces : {};
  const hasWorkspaceSurfacePolicy = Object.prototype.hasOwnProperty.call(options, "workspaceSurfacePolicy");
  const policySurfaces = hasWorkspaceSurfacePolicy
    ? applyWorkspaceSurfacePolicyToSurfaces({
        surfaces: sourceSurfaces,
        policy: options.workspaceSurfacePolicy
      })
    : sourceSurfaces;
  const surfaceIds = resolveSurfaceIds({
    surfaces: policySurfaces
  });

  const normalizedSurfaces = Object.fromEntries(
    surfaceIds.map((surfaceId) => {
      const source = policySurfaces[surfaceId] || {};
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
  validateTenancyModeAgainstSurfaces({
    tenancyMode,
    enabledSurfaceIds,
    normalizedSurfaces
  });
  const defaultSurfaceDefinition = Object.freeze({
    ...(normalizedSurfaces[registry.DEFAULT_SURFACE_ID] || {})
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
    return ids.map((surfaceId) =>
      Object.freeze({
        ...(normalizedSurfaces[surfaceId] || {})
      })
    );
  }

  function surfaceRequiresWorkspace(surfaceId) {
    return Boolean(getSurfaceDefinition(surfaceId)?.requiresWorkspace);
  }

  function listWorkspaceSurfaceIds() {
    return enabledSurfaceIds.filter((surfaceId) => Boolean(normalizedSurfaces[surfaceId]?.requiresWorkspace));
  }

  function listNonWorkspaceSurfaceIds() {
    return enabledSurfaceIds.filter((surfaceId) => !Boolean(normalizedSurfaces[surfaceId]?.requiresWorkspace));
  }

  function isSurfaceEnabled(surfaceId) {
    const normalizedSurface = normalizeSurfaceMode(surfaceId);
    if (normalizedSurface === allMode) {
      return false;
    }

    return enabledSurfaceIds.includes(normalizedSurface);
  }

  return {
    TENANCY_MODE_NONE,
    TENANCY_MODE_PERSONAL,
    TENANCY_MODE_WORKSPACE,
    TENANCY_MODE: tenancyMode,
    SURFACE_MODE_ALL: allMode,
    SURFACE_IDS: [...surfaceIds],
    DEFAULT_SURFACE_ID: registry.DEFAULT_SURFACE_ID,
    DEFAULT_SURFACE: defaultSurfaceDefinition,
    normalizeSurfaceMode,
    resolveSurfaceFromPathname: pathHelpers.resolveSurfaceFromPathname,
    getSurfaceDefinition,
    listSurfaceDefinitions,
    surfaceRequiresWorkspace,
    listWorkspaceSurfaceIds,
    listNonWorkspaceSurfaceIds,
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

  function resolveOwnRouteScope(route) {
    const metaScope =
      route && route.meta && route.meta.jskit && typeof route.meta.jskit === "object"
        ? route.meta.jskit.scope
        : "";
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

export {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  normalizeTenancyMode,
  createSurfaceRuntime,
  filterRoutesBySurface
};
