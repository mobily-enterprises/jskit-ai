import { computed, unref } from "vue";
import { resolveSurfaceIdFromPlacementPathname } from "@jskit-ai/shell-web/client/placement";
import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "../lib/workspaceSurfaceContext.js";

function resolveCurrentPathname(route = null) {
  const routePath = String(route?.path || "").trim();
  if (routePath) {
    return routePath;
  }

  if (typeof window === "object" && window?.location?.pathname) {
    return String(window.location.pathname);
  }

  return "/";
}

function useWorkspaceSurfaceId({ route = null, placementContext = null } = {}) {
  const currentSurfaceId = computed(() =>
    resolveSurfaceIdFromPlacementPathname(unref(placementContext), resolveCurrentPathname(route))
  );

  const workspaceSurfaceId = computed(() => {
    const contextValue = unref(placementContext);
    const surfaceId = String(currentSurfaceId.value || "").trim().toLowerCase();
    if (surfaceId && surfaceRequiresWorkspaceFromPlacementContext(contextValue, surfaceId)) {
      return surfaceId;
    }

    const targets = resolveSurfaceSwitchTargetsFromPlacementContext(contextValue, surfaceId);
    return String(targets.workspaceSurfaceId || "").trim().toLowerCase();
  });

  return Object.freeze({
    currentSurfaceId,
    workspaceSurfaceId
  });
}

export { useWorkspaceSurfaceId };
