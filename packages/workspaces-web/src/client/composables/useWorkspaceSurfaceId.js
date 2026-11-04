import { computed } from "vue";
import { resolveSurfaceIdFromPlacementPathname } from "@jskit-ai/shell-web/client/placement";
import { pagePathname } from "../browser.js";
import {
  resolveSurfaceSwitchTargetsFromPlacementContext,
  surfaceRequiresWorkspaceFromPlacementContext
} from "../lib/workspaceSurfaceContext.js";

function resolveCurrentPathname(route) {
  return String(route.path || "").trim() || pagePathname() || "/";
}

/**
 * The surface on the route, and the surface a workspace opens on from there.
 * @param {object} options
 * @param {import("vue-router").RouteLocationNormalizedLoaded} options.route
 * @param {import("vue").Ref<import("../types.js").WorkspacePlacementContext>} options.placementContext
 */
function useWorkspaceSurfaceId({ route, placementContext }) {
  const currentSurfaceId = computed(() =>
    resolveSurfaceIdFromPlacementPathname(placementContext.value, resolveCurrentPathname(route))
  );

  const workspaceSurfaceId = computed(() => {
    const contextValue = placementContext.value;
    const surfaceId = String(currentSurfaceId.value || "").trim().toLowerCase();
    if (surfaceId && surfaceRequiresWorkspaceFromPlacementContext(contextValue, surfaceId)) {
      return surfaceId;
    }

    const targets = resolveSurfaceSwitchTargetsFromPlacementContext(contextValue, surfaceId);
    return String(targets.workspaceSurfaceId || "").trim().toLowerCase();
  });

  return {
    currentSurfaceId,
    workspaceSurfaceId
  };
}

export { useWorkspaceSurfaceId };
