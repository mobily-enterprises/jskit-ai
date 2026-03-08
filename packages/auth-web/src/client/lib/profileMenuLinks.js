import {
  readPlacementSurfaceConfig,
  resolveSurfaceDefinitionFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function hasConsoleAccess(permissions) {
  if (!Array.isArray(permissions)) {
    return false;
  }

  const normalized = permissions.map((entry) => normalizeText(entry)).filter(Boolean);
  if (normalized.length < 1) {
    return false;
  }
  return normalized.includes("*") || normalized.includes("console.operator");
}

function resolvePrimarySurfaceSwitchLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const surfaceConfig = readPlacementSurfaceConfig(source);
  const currentSurface = resolveSurfaceDefinitionFromPlacementContext(source, surface);
  const currentSurfaceId = normalizeText(currentSurface?.id);
  const defaultSurfaceId = normalizeText(surfaceConfig.defaultSurfaceId);

  const enabledSurfaceIds = Array.isArray(surfaceConfig.enabledSurfaceIds) ? surfaceConfig.enabledSurfaceIds : [];
  const workspaceSurfaceId = enabledSurfaceIds.find(
    (surfaceId) => surfaceId !== currentSurfaceId && Boolean(surfaceConfig.surfacesById[surfaceId]?.requiresWorkspace)
  );
  const nonWorkspaceSurfaceId = enabledSurfaceIds.find(
    (surfaceId) => surfaceId !== currentSurfaceId && !Boolean(surfaceConfig.surfacesById[surfaceId]?.requiresWorkspace)
  );

  const defaultSurface = surfaceConfig.surfacesById[defaultSurfaceId] || null;
  const defaultSurfaceIsAppLike = Boolean(defaultSurface) && !Boolean(defaultSurface?.requiresWorkspace);

  if (currentSurface?.requiresWorkspace) {
    const appSurfaceId = defaultSurfaceIsAppLike && defaultSurfaceId !== currentSurfaceId
      ? defaultSurfaceId
      : nonWorkspaceSurfaceId;
    if (!appSurfaceId) {
      return null;
    }
    return {
      id: "surface-switch.primary",
      label: "Go to app",
      to: resolveSurfaceRootPathFromPlacementContext(source, appSurfaceId),
      icon: "mdi-open-in-new"
    };
  }

  if (!workspaceSurfaceId) {
    return null;
  }

  const workspaceSlug = String(source?.workspace?.slug || "").trim();
  const workspaceTarget = workspaceSlug
    ? resolveSurfaceWorkspacePathFromPlacementContext(source, workspaceSurfaceId, workspaceSlug)
    : resolveSurfaceRootPathFromPlacementContext(source, workspaceSurfaceId);

  return {
    id: "surface-switch.primary",
    label: "Go to workspace",
    to: workspaceTarget,
    icon: "mdi-briefcase-outline"
  };
}

function resolveGoToConsoleLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const authenticated = Boolean(source?.auth?.authenticated);
  if (!authenticated) {
    return null;
  }

  const surfaceConfig = readPlacementSurfaceConfig(source);
  const currentSurface = resolveSurfaceDefinitionFromPlacementContext(source, surface);
  const currentSurfaceId = normalizeText(currentSurface?.id);
  const consoleSurfaceId = surfaceConfig.enabledSurfaceIds.find((surfaceId) => normalizeText(surfaceId) === "console");
  if (!consoleSurfaceId || currentSurfaceId === consoleSurfaceId) {
    return null;
  }

  if (!hasConsoleAccess(source?.permissions)) {
    return null;
  }

  return {
    id: "surface-switch.console",
    label: "Go to console",
    to: resolveSurfaceRootPathFromPlacementContext(source, consoleSurfaceId),
    icon: "mdi-console"
  };
}

function resolveProfileMenuLinks({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const authenticated = Boolean(source?.auth?.authenticated);
  if (!authenticated) {
    return [];
  }

  const primary = resolvePrimarySurfaceSwitchLink({
    context: source,
    surface
  });
  const consoleLink = resolveGoToConsoleLink({
    context: source,
    surface
  });

  return [primary, consoleLink].filter(Boolean);
}

export {
  resolveProfileMenuLinks,
  resolvePrimarySurfaceSwitchLink,
  resolveGoToConsoleLink,
  hasConsoleAccess
};
