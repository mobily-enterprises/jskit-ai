import {
  normalizeSurfaceId,
  normalizeSurfacePrefix
} from "@jskit-ai/kernel/shared/surface";
import {
  normalizePathname,
  normalizeSurfaceSegmentFromPrefix,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId,
  resolveWorkspaceSurfaceIdFromSuffixSegments
} from "@jskit-ai/users-core/shared/support/workspacePathModel";

const TENANCY_MODE_NONE = "none";
const TENANCY_MODE_PERSONAL = "personal";
const TENANCY_MODE_WORKSPACE = "workspace";
const TENANCY_MODES = Object.freeze([TENANCY_MODE_NONE, TENANCY_MODE_PERSONAL, TENANCY_MODE_WORKSPACE]);

function normalizeTenancyMode(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!TENANCY_MODES.includes(normalized)) {
    return TENANCY_MODE_NONE;
  }
  return normalized;
}

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

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }
  return rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
}

function resolveDefaultWorkspaceSurfaceIdFromConfig(surfaceConfig = {}) {
  return resolveDefaultWorkspaceSurfaceId({
    defaultSurfaceId: surfaceConfig?.defaultSurfaceId,
    workspaceSurfaceIds: surfaceConfig?.workspaceSurfaceIds,
    surfaceRequiresWorkspace: (surfaceId) => Boolean(surfaceConfig?.surfacesById?.[surfaceId]?.requiresWorkspace)
  });
}

function resolveWorkspaceSurfaceIdFromPathname(surfaceConfig, pathname = "") {
  const parsedWorkspacePath = parseWorkspacePathname(pathname, {
    workspaceBasePath: "/w"
  });
  if (!parsedWorkspacePath) {
    return "";
  }

  const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceIdFromConfig(surfaceConfig);
  if (parsedWorkspacePath.suffixSegments.length < 1) {
    return defaultWorkspaceSurfaceId || normalizeSurfaceId(surfaceConfig?.defaultSurfaceId);
  }

  const workspaceSurfaces = (Array.isArray(surfaceConfig?.workspaceSurfaceIds) ? surfaceConfig.workspaceSurfaceIds : [])
    .map((surfaceId) => normalizeSurfaceId(surfaceId))
    .map((surfaceId) => {
      if (!surfaceId) {
        return null;
      }
      const definition = surfaceConfig.surfacesById?.[surfaceId];
      return {
        id: surfaceId,
        prefix: definition?.prefix
      };
    })
    .filter(Boolean);

  return (
    resolveWorkspaceSurfaceIdFromSuffixSegments({
      suffixSegments: parsedWorkspacePath.suffixSegments,
      defaultWorkspaceSurfaceId,
      workspaceSurfaces
    }) ||
    defaultWorkspaceSurfaceId ||
    normalizeSurfaceId(surfaceConfig?.defaultSurfaceId)
  );
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

function buildSurfaceConfigContext(surfaceRuntime = null, { tenancyMode = TENANCY_MODE_NONE } = {}) {
  const normalizedTenancyMode = normalizeTenancyMode(tenancyMode);
  if (!isRecord(surfaceRuntime)) {
    return normalizeSurfaceConfig({
      tenancyMode: normalizedTenancyMode
    });
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
    tenancyMode: normalizedTenancyMode,
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

function firstSurfaceIdByWorkspaceRequirement(surfaceConfig, {
  excludeSurfaceId = "",
  requiresWorkspace = false
} = {}) {
  const excludedSurfaceId = normalizeSurfaceId(excludeSurfaceId);
  for (const surfaceId of surfaceConfig.enabledSurfaceIds) {
    if (surfaceId === excludedSurfaceId) {
      continue;
    }

    const definition = surfaceConfig.surfacesById[surfaceId];
    if (!definition) {
      continue;
    }

    if (Boolean(definition.requiresWorkspace) === Boolean(requiresWorkspace)) {
      return surfaceId;
    }
  }

  return "";
}

function resolveSurfaceSwitchTargetsFromPlacementContext(contextValue = null, surfaceId = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const currentSurface = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  const currentSurfaceId = normalizeSurfaceId(currentSurface?.id);
  const defaultSurfaceId = normalizeSurfaceId(surfaceConfig.defaultSurfaceId);
  const defaultSurface = defaultSurfaceId ? surfaceConfig.surfacesById[defaultSurfaceId] || null : null;

  return Object.freeze({
    surfaceConfig,
    currentSurfaceId,
    currentSurface,
    defaultSurfaceId,
    defaultSurface,
    workspaceSurfaceId: firstSurfaceIdByWorkspaceRequirement(surfaceConfig, {
      excludeSurfaceId: currentSurfaceId,
      requiresWorkspace: true
    }),
    nonWorkspaceSurfaceId: firstSurfaceIdByWorkspaceRequirement(surfaceConfig, {
      excludeSurfaceId: currentSurfaceId,
      requiresWorkspace: false
    })
  });
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

  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  const surfaceDefinition = surfaceConfig.surfacesById[normalizedSurfaceId] || null;
  const normalizedSuffix = normalizeWorkspaceSuffix(suffix);

  if (surfaceDefinition && !surfaceDefinition.requiresWorkspace) {
    if (normalizedSuffix === "/") {
      return resolveSurfaceRootPathFromPlacementContext(contextValue, normalizedSurfaceId);
    }
    return resolveSurfacePathFromPlacementContext(contextValue, normalizedSurfaceId, normalizedSuffix);
  }

  let workspaceRootPath = `/w/${normalizedWorkspaceSlug}`;
  const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceIdFromConfig(surfaceConfig);
  if (normalizedSurfaceId && normalizedSurfaceId !== defaultWorkspaceSurfaceId) {
    const surfaceSegment = normalizeSurfaceSegmentFromPrefix(surfaceDefinition?.prefix) || normalizedSurfaceId;
    if (surfaceSegment) {
      workspaceRootPath = `${workspaceRootPath}/${surfaceSegment}`;
    }
  }

  if (normalizedSuffix === "/") {
    return normalizePathname(workspaceRootPath);
  }
  return normalizePathname(`${workspaceRootPath}${normalizedSuffix}`);
}

function resolveSurfaceIdFromPlacementPathname(contextValue = null, pathname = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const normalizedPathname =
    normalizePathname(pathname) ||
    (typeof window === "object" && window?.location?.pathname ? normalizePathname(window.location.pathname) : "/");

  const workspaceSurfaceId = resolveWorkspaceSurfaceIdFromPathname(surfaceConfig, normalizedPathname);
  if (workspaceSurfaceId) {
    return workspaceSurfaceId;
  }

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
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedSurfaceId) {
    return "";
  }
  if (!surfaceRequiresWorkspaceFromPlacementContext(contextValue, normalizedSurfaceId)) {
    return "";
  }

  const parsedWorkspacePath = parseWorkspacePathname(normalizedPathname);
  if (!parsedWorkspacePath) {
    return "";
  }

  const resolvedSurfaceId = resolveSurfaceIdFromPlacementPathname(contextValue, normalizedPathname);
  if (resolvedSurfaceId !== normalizedSurfaceId) {
    return "";
  }

  return parsedWorkspacePath.workspaceSlug;
}

function resolveSurfaceApiPathFromPlacementContext(contextValue = null, surfaceId = "", pathname = "", apiBasePath = "/api") {
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  const normalizedApiBasePath = normalizePathname(apiBasePath);
  const normalizedSurfacePrefix = normalizeSurfacePrefix(surfaceDefinition?.prefix);
  const prefixedApiBasePath =
    normalizedSurfacePrefix === "/app"
      ? normalizedApiBasePath
      : joinSurfacePath(normalizedApiBasePath, normalizedSurfacePrefix);
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
  resolveSurfaceSwitchTargetsFromPlacementContext,
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
