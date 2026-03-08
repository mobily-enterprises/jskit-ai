import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext
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

function resolvePrimarySurfaceSwitchLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(source, surface);
  const currentSurfaceIsWorkspace = isWorkspaceSurface(targets.currentSurface);
  const defaultSurfaceIsWorkspace = isWorkspaceSurface(targets.defaultSurface);

  if (currentSurfaceIsWorkspace) {
    let appSurfaceId = targets.nonWorkspaceSurfaceId;
    if (!defaultSurfaceIsWorkspace && targets.defaultSurfaceId !== targets.currentSurfaceId) {
      appSurfaceId = targets.defaultSurfaceId;
    }

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

  if (!targets.workspaceSurfaceId) {
    return null;
  }

  const workspaceSlug = String(source?.workspace?.slug || "").trim();
  let workspaceTarget = resolveSurfaceRootPathFromPlacementContext(source, targets.workspaceSurfaceId);
  if (workspaceSlug) {
    workspaceTarget = resolveSurfaceWorkspacePathFromPlacementContext(source, targets.workspaceSurfaceId, workspaceSlug);
  }

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
