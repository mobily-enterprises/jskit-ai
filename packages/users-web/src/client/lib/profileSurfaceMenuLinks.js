import {
  resolveSurfaceIdFromPlacementPathname
} from "@jskit-ai/shell-web/client/placement";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspaceShellLinkPath } from "./workspaceLinkResolver.js";
import { resolveSurfaceSwitchTargetsFromPlacementContext } from "./workspaceSurfaceContext.js";
import {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "./workspaceSurfacePaths.js";

function isWorkspaceSurface(surfaceDefinition) {
  return Boolean(surfaceDefinition && surfaceDefinition.requiresWorkspace === true);
}

function hasConsoleAccess(permissions) {
  if (!Array.isArray(permissions)) {
    return false;
  }

  const normalized = permissions.map((entry) => normalizeLowerText(entry)).filter(Boolean);
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
  const currentSurfaceId =
    resolveWorkspaceSurfaceIdFromPlacementPathname(context, pathname) ||
    resolveSurfaceIdFromPlacementPathname(context, pathname) ||
    surfaceId;
  return String(extractWorkspaceSlugFromSurfacePathname(context, currentSurfaceId, pathname) || "").trim();
}

function hasWorkspaceMembership(contextValue, workspaceSlug) {
  const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
  if (!normalizedWorkspaceSlug) {
    return false;
  }

  const context = contextValue && typeof contextValue === "object" ? contextValue : {};
  const currentWorkspaceSlug = normalizeLowerText(context?.workspace?.slug);
  if (currentWorkspaceSlug && currentWorkspaceSlug === normalizedWorkspaceSlug) {
    return true;
  }

  const workspaces = Array.isArray(context?.workspaces) ? context.workspaces : [];
  for (const workspace of workspaces) {
    if (normalizeLowerText(workspace?.slug) === normalizedWorkspaceSlug) {
      return true;
    }
  }

  return false;
}

function resolvePrimarySurfaceSwitchLink({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(source, surface);
  const resolvedWorkspaceSlug = resolveCurrentWorkspaceSlug(source, targets.currentSurfaceId || surface);
  const workspaceSlug = hasWorkspaceMembership(source, resolvedWorkspaceSlug) ? resolvedWorkspaceSlug : "";
  const enabledSurfaceIds = Array.isArray(targets?.surfaceConfig?.enabledSurfaceIds)
    ? targets.surfaceConfig.enabledSurfaceIds
    : [];
  const appSurfaceId = enabledSurfaceIds.find((surfaceId) => normalizeLowerText(surfaceId) === "app") || "";
  const adminSurfaceId = enabledSurfaceIds.find((surfaceId) => normalizeLowerText(surfaceId) === "admin") || "";
  const appSurface = appSurfaceId ? targets.surfaceConfig.surfacesById[appSurfaceId] : null;
  const adminSurface = adminSurfaceId ? targets.surfaceConfig.surfacesById[adminSurfaceId] : null;
  const appSurfaceIsWorkspace = isWorkspaceSurface(appSurface);
  const adminSurfaceIsWorkspace = isWorkspaceSurface(adminSurface);

  if (workspaceSlug) {
    if (targets.currentSurfaceId === appSurfaceId && adminSurfaceId && adminSurfaceIsWorkspace) {
      return {
        id: "surface-switch.primary",
        label: "Go to admin",
        to: resolveWorkspaceShellLinkPath({
          context: source,
          surface: adminSurfaceId,
          workspaceSlug,
          mode: "workspace",
          relativePath: "/"
        })
      };
    }

    if (targets.currentSurfaceId === adminSurfaceId && appSurfaceId && appSurfaceIsWorkspace) {
      return {
        id: "surface-switch.primary",
        label: "Go to app",
        to: resolveWorkspaceShellLinkPath({
          context: source,
          surface: appSurfaceId,
          workspaceSlug,
          mode: "workspace",
          relativePath: "/"
        })
      };
    }
  }

  if (appSurfaceId && appSurfaceIsWorkspace && workspaceSlug) {
    if (targets.currentSurfaceId === appSurfaceId) {
      return null;
    }
    return {
      id: "surface-switch.primary",
      label: "Go to workspace",
      to: resolveWorkspaceShellLinkPath({
        context: source,
        surface: appSurfaceId,
        workspaceSlug,
        mode: "workspace",
        relativePath: "/"
      })
    };
  }

  if (appSurfaceId && !appSurfaceIsWorkspace) {
    if (targets.currentSurfaceId === appSurfaceId) {
      return null;
    }
    return {
      id: "surface-switch.primary",
      label: "Go to app",
      to: resolveWorkspaceShellLinkPath({
        context: source,
        surface: appSurfaceId,
        mode: "surface",
        relativePath: "/"
      })
    };
  }

  if (!targets.workspaceSurfaceId || !workspaceSlug) {
    return null;
  }

  if (targets.currentSurfaceId === targets.workspaceSurfaceId) {
    return null;
  }

  const workspaceTarget = resolveWorkspaceShellLinkPath({
    context: source,
    surface: targets.workspaceSurfaceId,
    workspaceSlug,
    mode: "workspace",
    relativePath: "/"
  });

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
  const consoleSurfaceId = targets.surfaceConfig.enabledSurfaceIds.find(
    (surfaceId) => normalizeLowerText(surfaceId) === "console"
  );
  if (!consoleSurfaceId || targets.currentSurfaceId === consoleSurfaceId) {
    return null;
  }

  if (!hasConsoleAccess(source?.permissions)) {
    return null;
  }

  return {
    id: "surface-switch.console",
    label: "Go to console",
    to: resolveWorkspaceShellLinkPath({
      context: source,
      surface: consoleSurfaceId,
      mode: "surface",
      relativePath: "/"
    })
  };
}

function resolveProfileSurfaceMenuLinks({ context, surface } = {}) {
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
  resolveProfileSurfaceMenuLinks,
  resolvePrimarySurfaceSwitchLink,
  resolveGoToConsoleLink,
  hasConsoleAccess,
  hasWorkspaceMembership
};
