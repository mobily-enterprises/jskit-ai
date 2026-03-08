import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isWorkspaceSurface(surfaceDefinition) {
  return Boolean(surfaceDefinition && surfaceDefinition.requiresWorkspace === true);
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

function resolveCurrentWorkspaceSlug(contextValue, surfaceId) {
  const context = contextValue && typeof contextValue === "object" ? contextValue : {};
  const workspaceSlugFromContext = String(context?.workspace?.slug || "").trim();
  if (workspaceSlugFromContext) {
    return workspaceSlugFromContext;
  }

  if (typeof window !== "object" || !window?.location?.pathname) {
    return "";
  }

  const pathname = String(window.location.pathname || "").trim();
  const currentSurfaceId = resolveSurfaceIdFromPlacementPathname(context, pathname) || surfaceId;
  return String(extractWorkspaceSlugFromSurfacePathname(context, currentSurfaceId, pathname) || "").trim();
}

function resolvePrimarySurfaceSwitchLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(source, surface);
  const currentSurfaceIsWorkspace = isWorkspaceSurface(targets.currentSurface);
  const defaultSurfaceIsWorkspace = isWorkspaceSurface(targets.defaultSurface);
  const workspaceSlug = resolveCurrentWorkspaceSlug(source, targets.currentSurfaceId || surface);

  if (currentSurfaceIsWorkspace) {
    let appSurfaceId = targets.nonWorkspaceSurfaceId;
    if (!defaultSurfaceIsWorkspace && targets.defaultSurfaceId !== targets.currentSurfaceId) {
      appSurfaceId = targets.defaultSurfaceId;
    }

    if (!appSurfaceId || !workspaceSlug) {
      return null;
    }

    return {
      id: "surface-switch.primary",
      label: "Go to app",
      to: resolveSurfaceWorkspacePathFromPlacementContext(source, appSurfaceId, workspaceSlug)
    };
  }

  if (!targets.workspaceSurfaceId || !workspaceSlug) {
    return null;
  }

  const workspaceTarget = resolveSurfaceWorkspacePathFromPlacementContext(source, targets.workspaceSurfaceId, workspaceSlug);

  return {
    id: "surface-switch.primary",
    label: "Go to workspace",
    to: workspaceTarget
  };
}

function resolveGoToConsoleLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const authenticated = Boolean(source?.auth?.authenticated);
  if (!authenticated) {
    return null;
  }

  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(source, surface);
  const consoleSurfaceId = targets.surfaceConfig.enabledSurfaceIds.find((surfaceId) => normalizeText(surfaceId) === "console");
  if (!consoleSurfaceId || targets.currentSurfaceId === consoleSurfaceId) {
    return null;
  }

  if (!hasConsoleAccess(source?.permissions)) {
    return null;
  }

  return {
    id: "surface-switch.console",
    label: "Go to console",
    to: resolveSurfaceRootPathFromPlacementContext(source, consoleSurfaceId)
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
