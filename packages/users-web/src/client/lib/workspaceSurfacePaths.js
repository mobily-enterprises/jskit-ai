import {
  normalizeSurfaceId
} from "@jskit-ai/kernel/shared/surface";
import {
  normalizePathname,
  normalizeSurfaceSegmentFromRouteBase,
  parseWorkspacePathname,
  resolveDefaultWorkspaceSurfaceId,
  resolveWorkspaceSurfaceIdFromSuffixSegments
} from "@jskit-ai/users-core/shared/support/workspacePathModel";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfacePathFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  joinSurfacePath
} from "@jskit-ai/shell-web/client/placement";
import {
  listWorkspaceSurfaceIdsFromSurfaceConfig,
  surfaceRequiresWorkspaceFromPlacementContext
} from "./workspaceSurfaceContext.js";

function normalizeWorkspaceSuffix(suffix) {
  const rawSuffix = String(suffix || "/").trim();
  if (!rawSuffix || rawSuffix === "/") {
    return "/";
  }
  return rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`;
}

function resolveWorkspaceSurfaceIdFromSurfaceConfig(surfaceConfig, pathname = "") {
  const parsedWorkspacePath = parseWorkspacePathname(pathname, {
    workspaceBasePath: "/w"
  });
  if (!parsedWorkspacePath) {
    return "";
  }

  const workspaceSurfaceIds = listWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig);
  const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceId({
    defaultSurfaceId: surfaceConfig?.defaultSurfaceId,
    workspaceSurfaceIds,
    surfaceRequiresWorkspace: (surfaceId) => Boolean(surfaceConfig?.surfacesById?.[surfaceId]?.requiresWorkspace)
  });
  if (parsedWorkspacePath.suffixSegments.length < 1) {
    return defaultWorkspaceSurfaceId || normalizeSurfaceId(surfaceConfig?.defaultSurfaceId);
  }

  const workspaceSurfaces = workspaceSurfaceIds
    .map((surfaceId) => normalizeSurfaceId(surfaceId))
    .map((surfaceId) => {
      if (!surfaceId) {
        return null;
      }
      const definition = surfaceConfig.surfacesById?.[surfaceId];
      return {
        id: surfaceId,
        routeBase: definition?.routeBase
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

function resolveWorkspaceSurfaceIdFromPlacementPathname(contextValue = null, pathname = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const normalizedPathname =
    normalizePathname(pathname) ||
    (typeof window === "object" && window?.location?.pathname ? normalizePathname(window.location.pathname) : "/");

  return resolveWorkspaceSurfaceIdFromSurfaceConfig(surfaceConfig, normalizedPathname);
}

function resolveSurfaceWorkspacePathFromPlacementContext(contextValue = null, surfaceId = "", workspaceSlug = "", suffix = "/") {
  const normalizedWorkspaceSlug = String(workspaceSlug || "").trim();
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedWorkspaceSlug) {
    return "/account/settings";
  }

  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const surfaceDefinition = surfaceConfig.surfacesById[normalizedSurfaceId] || null;
  const normalizedSuffix = normalizeWorkspaceSuffix(suffix);

  if (surfaceDefinition && !surfaceDefinition.requiresWorkspace) {
    if (normalizedSuffix === "/") {
      return resolveSurfaceRootPathFromPlacementContext(contextValue, normalizedSurfaceId);
    }
    return resolveSurfacePathFromPlacementContext(contextValue, normalizedSurfaceId, normalizedSuffix);
  }

  let workspaceRootPath = `/w/${normalizedWorkspaceSlug}`;
  const workspaceSurfaceIds = listWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig);
  const defaultWorkspaceSurfaceId = resolveDefaultWorkspaceSurfaceId({
    defaultSurfaceId: surfaceConfig?.defaultSurfaceId,
    workspaceSurfaceIds,
    surfaceRequiresWorkspace: (candidateSurfaceId) => Boolean(surfaceConfig?.surfacesById?.[candidateSurfaceId]?.requiresWorkspace)
  });
  if (normalizedSurfaceId && normalizedSurfaceId !== defaultWorkspaceSurfaceId) {
    const surfaceSegment = normalizeSurfaceSegmentFromRouteBase(surfaceDefinition?.routeBase) || normalizedSurfaceId;
    if (surfaceSegment) {
      workspaceRootPath = `${workspaceRootPath}/${surfaceSegment}`;
    }
  }

  if (normalizedSuffix === "/") {
    return normalizePathname(workspaceRootPath);
  }
  return normalizePathname(`${workspaceRootPath}${normalizedSuffix}`);
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

  const resolvedSurfaceId = resolveWorkspaceSurfaceIdFromPlacementPathname(contextValue, normalizedPathname);
  if (resolvedSurfaceId !== normalizedSurfaceId) {
    return "";
  }

  return parsedWorkspacePath.workspaceSlug;
}

function resolveSurfaceApiPathFromPlacementContext(contextValue = null, surfaceId = "", pathname = "", apiBasePath = "/api") {
  const surfaceDefinition = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  const normalizedApiBasePath = normalizePathname(apiBasePath);
  const normalizedSurfaceRouteBase = normalizePathname(surfaceDefinition?.routeBase || "/");
  const prefixedApiBasePath = joinSurfacePath(normalizedApiBasePath, normalizedSurfaceRouteBase);
  const normalizedPathname = String(pathname || "").trim();
  if (!normalizedPathname) {
    return prefixedApiBasePath;
  }
  return joinSurfacePath(prefixedApiBasePath, normalizedPathname);
}

export {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext
};
