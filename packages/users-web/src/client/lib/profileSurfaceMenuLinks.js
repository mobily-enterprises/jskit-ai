import {
  resolveSurfaceIdFromPlacementPathname
} from "@jskit-ai/shell-web/client/placement";
import { resolveWorkspaceShellLinkPath } from "./workspaceLinkResolver.js";
import { resolveSurfaceSwitchTargetsFromPlacementContext } from "./workspaceSurfaceContext.js";
import { evaluateSurfaceAccess, hasWorkspaceMembership } from "./surfaceAccessPolicy.js";
import {
  resolveWorkspaceSurfaceIdFromPlacementPathname,
  extractWorkspaceSlugFromSurfacePathname
} from "./workspaceSurfacePaths.js";

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

function shouldIncludeSurfaceSwitchTarget(surfaceDefinition = null) {
  if (!surfaceDefinition || typeof surfaceDefinition !== "object") {
    return false;
  }

  if (surfaceDefinition.enabled === false) {
    return false;
  }

  if (surfaceDefinition.showInSurfaceSwitchMenu === true) {
    return true;
  }
  if (surfaceDefinition.showInSurfaceSwitchMenu === false) {
    return false;
  }

  return surfaceDefinition.requiresWorkspace === true || surfaceDefinition.requiresAuth === true;
}

function resolveSurfaceSwitchLinkLabel(surfaceDefinition = null, surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim();
  const configuredLabel = String(surfaceDefinition?.label || "").trim();
  const label = configuredLabel || normalizedSurfaceId;
  if (!label) {
    return "Go to surface";
  }
  return `Go to ${label.toLowerCase()}`;
}

function resolveSurfaceSwitchLinks({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const targets = resolveSurfaceSwitchTargetsFromPlacementContext(source, surface);
  const currentSurfaceId = String(targets.currentSurfaceId || "").trim().toLowerCase();
  const resolvedWorkspaceSlug = resolveCurrentWorkspaceSlug(source, currentSurfaceId || surface);
  const workspaceSlug = hasWorkspaceMembership(source, resolvedWorkspaceSlug) ? resolvedWorkspaceSlug : "";
  const enabledSurfaceIds = Array.isArray(targets?.surfaceConfig?.enabledSurfaceIds)
    ? targets.surfaceConfig.enabledSurfaceIds
    : [];
  const links = [];

  for (const targetSurfaceIdCandidate of enabledSurfaceIds) {
    const targetSurfaceId = String(targetSurfaceIdCandidate || "").trim().toLowerCase();
    if (!targetSurfaceId) {
      continue;
    }
    if (targetSurfaceId === currentSurfaceId) {
      continue;
    }

    const targetSurface = targets.surfaceConfig.surfacesById[targetSurfaceId] || null;
    if (!shouldIncludeSurfaceSwitchTarget(targetSurface)) {
      continue;
    }

    const targetWorkspaceSlug = targetSurface?.requiresWorkspace === true ? workspaceSlug : "";
    if (targetSurface?.requiresWorkspace === true && !targetWorkspaceSlug) {
      continue;
    }

    const accessDecision = evaluateSurfaceAccess({
      context: source,
      surfaceId: targetSurfaceId,
      workspaceSlug: targetWorkspaceSlug
    });
    if (!accessDecision.allowed) {
      continue;
    }

    links.push({
      id: `surface-switch.${targetSurfaceId}`,
      label: resolveSurfaceSwitchLinkLabel(targetSurface, targetSurfaceId),
      to: resolveWorkspaceShellLinkPath({
        context: source,
        surface: targetSurfaceId,
        workspaceSlug: targetWorkspaceSlug,
        mode: targetSurface?.requiresWorkspace === true ? "workspace" : "surface",
        relativePath: "/"
      })
    });
  }

  return links;
}

function resolvePrimarySurfaceSwitchLink({ context, surface } = {}) {
  const links = resolveSurfaceSwitchLinks({
    context,
    surface
  });
  return links[0] || null;
}

function resolveProfileSurfaceMenuLinks({ context, surface } = {}) {
  const source = context && typeof context === "object" ? context : {};
  const authenticated = Boolean(source?.auth?.authenticated);
  if (!authenticated) {
    return [];
  }
  return resolveSurfaceSwitchLinks({
    context: source,
    surface
  });
}

export {
  resolveProfileSurfaceMenuLinks,
  resolvePrimarySurfaceSwitchLink,
  resolveSurfaceSwitchLinks,
  hasWorkspaceMembership
};
