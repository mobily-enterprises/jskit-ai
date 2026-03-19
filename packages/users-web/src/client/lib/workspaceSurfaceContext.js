import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function listWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig = null) {
  const source = surfaceConfig && typeof surfaceConfig === "object" ? surfaceConfig : {};
  const enabledSurfaceIds = Array.isArray(source.enabledSurfaceIds) ? source.enabledSurfaceIds : [];
  const surfacesById = source.surfacesById && typeof source.surfacesById === "object" ? source.surfacesById : {};

  const workspaceSurfaceIds = [];
  for (const candidate of enabledSurfaceIds) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId) {
      continue;
    }
    if (surfacesById[surfaceId]?.requiresWorkspace !== true) {
      continue;
    }
    workspaceSurfaceIds.push(surfaceId);
  }
  return workspaceSurfaceIds;
}

function listNonWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig = null) {
  const source = surfaceConfig && typeof surfaceConfig === "object" ? surfaceConfig : {};
  const enabledSurfaceIds = Array.isArray(source.enabledSurfaceIds) ? source.enabledSurfaceIds : [];
  const surfacesById = source.surfacesById && typeof source.surfacesById === "object" ? source.surfacesById : {};

  const nonWorkspaceSurfaceIds = [];
  for (const candidate of enabledSurfaceIds) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId) {
      continue;
    }
    if (surfacesById[surfaceId]?.requiresWorkspace === true) {
      continue;
    }
    nonWorkspaceSurfaceIds.push(surfaceId);
  }
  return nonWorkspaceSurfaceIds;
}

function surfaceRequiresWorkspaceFromPlacementContext(contextValue = null, surfaceId = "") {
  return Boolean(resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId)?.requiresWorkspace);
}

function firstAlternativeSurfaceId(surfaceIds = [], excludeSurfaceId = "") {
  const normalizedExcludeSurfaceId = normalizeSurfaceId(excludeSurfaceId);
  for (const candidate of Array.isArray(surfaceIds) ? surfaceIds : []) {
    const surfaceId = normalizeSurfaceId(candidate);
    if (!surfaceId || surfaceId === normalizedExcludeSurfaceId) {
      continue;
    }
    return surfaceId;
  }
  return "";
}

function resolveSurfaceSwitchTargetsFromPlacementContext(contextValue = null, surfaceId = "") {
  const surfaceConfig = readPlacementSurfaceConfig(contextValue);
  const currentSurface = resolveSurfaceDefinitionFromPlacementContext(contextValue, surfaceId);
  const currentSurfaceId = normalizeSurfaceId(currentSurface?.id);
  const defaultSurfaceId = normalizeSurfaceId(surfaceConfig.defaultSurfaceId);
  const defaultSurface = defaultSurfaceId ? surfaceConfig.surfacesById[defaultSurfaceId] || null : null;
  const workspaceSurfaceIds = listWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig);
  const nonWorkspaceSurfaceIds = listNonWorkspaceSurfaceIdsFromSurfaceConfig(surfaceConfig);

  return Object.freeze({
    surfaceConfig,
    currentSurfaceId,
    currentSurface,
    defaultSurfaceId,
    defaultSurface,
    workspaceSurfaceId: firstAlternativeSurfaceId(workspaceSurfaceIds, currentSurfaceId),
    nonWorkspaceSurfaceId: firstAlternativeSurfaceId(nonWorkspaceSurfaceIds, currentSurfaceId)
  });
}

export {
  listWorkspaceSurfaceIdsFromSurfaceConfig,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceSwitchTargetsFromPlacementContext
};
