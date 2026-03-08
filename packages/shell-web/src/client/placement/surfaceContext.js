import {
  normalizeSurfaceId,
  normalizeSurfacePrefix,
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  normalizeTenancyMode
} from "@jskit-ai/kernel/shared/surface";

const EMPTY_SURFACE_CONFIG = Object.freeze({
  tenancyMode: TENANCY_MODE_NONE,
  defaultSurfaceId: "",
  enabledSurfaceIds: Object.freeze([]),
  workspaceSurfaceIds: Object.freeze([]),
  nonWorkspaceSurfaceIds: Object.freeze([]),
  surfacesById: Object.freeze({})
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeSurfaceIdList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  for (const candidate of value) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId || seen.has(surfaceId)) {
      continue;
    }
    seen.add(surfaceId);
    normalized.push(surfaceId);
  }
  return normalized;
}

function normalizePathname(pathname) {
  const rawValue = String(pathname || "/").trim();
  if (!rawValue) {
    return "/";
  }

  const withoutQuery = rawValue.split("?")[0].split("#")[0];
  const withLeadingSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (squashed === "/") {
    return "/";
  }

  return squashed.replace(/\/+$/, "") || "/";
}

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }
  return rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
}

function normalizeSurfaceConfig(surfaceConfig = {}) {
  const source = isRecord(surfaceConfig) ? surfaceConfig : {};
  const enabledSurfaceIds = normalizeSurfaceIdList(source.enabledSurfaceIds);
  const enabledSet = new Set(enabledSurfaceIds);
  const rawSurfacesById = isRecord(source.surfacesById) ? source.surfacesById : {};
  const normalizedSurfacesById = {};

  for (const [rawSurfaceId, rawDefinition] of Object.entries(rawSurfacesById)) {
    const definition = isRecord(rawDefinition) ? rawDefinition : {};
    const surfaceId = normalizeSurfaceId(definition.id || rawSurfaceId);
    if (!surfaceId) {
      continue;
    }
    const enabled = enabledSet.size > 0 ? enabledSet.has(surfaceId) : definition.enabled !== false;
    normalizedSurfacesById[surfaceId] = Object.freeze({
      id: surfaceId,
      prefix: normalizeSurfacePrefix(definition.prefix),
      enabled,
      requiresWorkspace: Boolean(definition.requiresWorkspace)
    });
  }

  const derivedEnabledSurfaceIds =
    enabledSurfaceIds.length > 0
      ? enabledSurfaceIds.filter((surfaceId) => Boolean(normalizedSurfacesById[surfaceId]))
      : Object.values(normalizedSurfacesById)
          .filter((definition) => definition.enabled)
          .map((definition) => definition.id);
  const workspaceSurfaceIds = derivedEnabledSurfaceIds.filter(
    (surfaceId) => Boolean(normalizedSurfacesById[surfaceId]?.requiresWorkspace)
  );
  const nonWorkspaceSurfaceIds = derivedEnabledSurfaceIds.filter(
    (surfaceId) => !normalizedSurfacesById[surfaceId]?.requiresWorkspace
  );
  const defaultSurfaceId = normalizeSurfaceId(source.defaultSurfaceId);
  const resolvedDefaultSurfaceId = normalizedSurfacesById[defaultSurfaceId]
    ? defaultSurfaceId
    : derivedEnabledSurfaceIds[0] || Object.keys(normalizedSurfacesById)[0] || "";

  return Object.freeze({
    tenancyMode: normalizeTenancyMode(source.tenancyMode),
    defaultSurfaceId: resolvedDefaultSurfaceId,
    enabledSurfaceIds: Object.freeze([...derivedEnabledSurfaceIds]),
    workspaceSurfaceIds: Object.freeze([...workspaceSurfaceIds]),
    nonWorkspaceSurfaceIds: Object.freeze([...nonWorkspaceSurfaceIds]),
    surfacesById: Object.freeze({
      ...normalizedSurfacesById
    })
  });
}

function buildSurfaceConfigContext(surfaceRuntime = null) {
  if (!isRecord(surfaceRuntime)) {
    return EMPTY_SURFACE_CONFIG;
  }

  const surfaceDefinitions =
    typeof surfaceRuntime.listSurfaceDefinitions === "function" ? surfaceRuntime.listSurfaceDefinitions() : [];
  const surfacesById = {};
  for (const definition of Array.isArray(surfaceDefinitions) ? surfaceDefinitions : []) {
    if (!isRecord(definition)) {
      continue;
    }
    const surfaceId = normalizeSurfaceId(definition.id);
    if (!surfaceId) {
      continue;
    }
    surfacesById[surfaceId] = definition;
  }

  return normalizeSurfaceConfig({
    tenancyMode: surfaceRuntime.TENANCY_MODE,
    defaultSurfaceId: surfaceRuntime.DEFAULT_SURFACE_ID,
    enabledSurfaceIds:
      typeof surfaceRuntime.listEnabledSurfaceIds === "function" ? surfaceRuntime.listEnabledSurfaceIds() : [],
    surfacesById
  });
}

function readPlacementSurfaceConfig(contextValue = null) {
  const contextRecord = isRecord(contextValue) ? contextValue : {};
  return normalizeSurfaceConfig(contextRecord.surfaceConfig);
}

function resolveSurfaceDefinitionFromPlacementContext(contextValue = null, surfaceId = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedSurfaceId) {
    return null;
  }
  return surfaceConfig.surfacesById[normalizedSurfaceId] || null;
}

function surfaceRequiresWorkspaceFromPlacementContext(contextValue = null, surfaceId = "") {
  return Boolean(resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId)?.requiresWorkspace);
}

function joinSurfacePath(surfacePrefix = "", pathname = "") {
  const normalizedPrefix = normalizeSurfacePrefix(surfacePrefix);
  const rawPathname = String(pathname || "").trim();
  if (!rawPathname) {
    return normalizedPrefix || "/";
  }

  const withLeadingSlash = rawPathname.startsWith("/") ? rawPathname : `/${rawPathname}`;
  const normalizedPathname = withLeadingSlash.replace(/\/{2,}/g, "/");
  const joined = `${normalizedPrefix}${normalizedPathname}`;
  const compacted = joined.replace(/\/{2,}/g, "/");
  if (!compacted) {
    return "/";
  }
  return compacted === "/" ? compacted : compacted.replace(/\/+$/, "") || "/";
}

function resolveSurfaceRootPathFromPlacementContext(contextValue = null, surfaceId = "") {
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  return joinSurfacePath(surfaceDefinition?.prefix, "");
}

function resolveSurfacePathFromPlacementContext(contextValue = null, surfaceId = "", pathname = "") {
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  return joinSurfacePath(surfaceDefinition?.prefix, pathname);
}

function resolveSurfaceWorkspacesPathFromPlacementContext(contextValue = null, surfaceId = "") {
  return resolveSurfacePathFromPlacementContext(contextValue, surfaceId, "/workspaces");
}

function resolveSurfaceWorkspacePathFromPlacementContext(contextValue = null, surfaceId = "", workspaceSlug = "", suffix = "/") {
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  if (!normalizedWorkspaceSlug) {
    return resolveSurfaceWorkspacesPathFromPlacementContext(contextValue, surfaceId);
  }
  const normalizedSuffix = normalizeWorkspaceSuffix(suffix);
  const relativePath =
    normalizedSuffix === "/" ? `/w/${normalizedWorkspaceSlug}` : `/w/${normalizedWorkspaceSlug}${normalizedSuffix}`;
  return resolveSurfacePathFromPlacementContext(contextValue, surfaceId, relativePath);
}

function resolveSurfaceIdFromPlacementPathname(contextValue = null, pathname = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const normalizedPathname =
    normalizePathname(pathname) ||
    (typeof window === "object" && window?.location?.pathname ? normalizePathname(window.location.pathname) : "/");
  const enabledSurfaces = surfaceConfig.enabledSurfaceIds
    .map((surfaceId) => surfaceConfig.surfacesById[surfaceId])
    .filter(Boolean)
    .sort((left, right) => String(right.prefix || "").length - String(left.prefix || "").length);

  for (const surfaceDefinition of enabledSurfaces) {
    const normalizedPrefix = normalizeSurfacePrefix(surfaceDefinition.prefix);
    if (!normalizedPrefix) {
      continue;
    }

    if (normalizedPathname === normalizedPrefix || normalizedPathname.startsWith(`${normalizedPrefix}/`)) {
      return surfaceDefinition.id;
    }
  }

  return surfaceConfig.defaultSurfaceId || enabledSurfaces[0]?.id || "";
}

function extractWorkspaceSlugFromSurfacePathname(contextValue = null, surfaceId = "", pathname = "") {
  const normalizedPathname = normalizePathname(
    pathname || (typeof window === "object" && window?.location?.pathname ? window.location.pathname : "/")
  );
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  if (!surfaceDefinition) {
    return "";
  }

  const workspaceBasePath = joinSurfacePath(surfaceDefinition.prefix, "/w");
  if (!normalizedPathname.startsWith(`${workspaceBasePath}/`)) {
    return "";
  }

  const trailingPath = normalizedPathname.slice(`${workspaceBasePath}/`.length);
  const [workspaceSlug] = trailingPath.split("/");
  return String(workspaceSlug || "").trim();
}

function resolveSurfaceApiPathFromPlacementContext(contextValue = null, surfaceId = "", pathname = "", apiBasePath = "/api") {
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  const normalizedApiBasePath = normalizePathname(apiBasePath);
  const prefixedApiBasePath = joinSurfacePath(normalizedApiBasePath, surfaceDefinition?.prefix);
  const normalizedPathname = String(pathname || "").trim();
  if (!normalizedPathname) {
    return prefixedApiBasePath;
  }
  return joinSurfacePath(prefixedApiBasePath, normalizedPathname);
}

export {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  EMPTY_SURFACE_CONFIG,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacesPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
};
