import { computed } from "vue";
import {
  extractWorkspaceSlugFromSurfacePathname
} from "../lib/workspaceSurfacePaths.js";
import { useSurfaceRouteContext } from "@jskit-ai/users-web/client/composables/useSurfaceRouteContext";

function useWorkspaceRouteContext() {
  const { route, routePath, placementContext, mergePlacementContext, currentSurfaceId } = useSurfaceRouteContext();
  const workspaceSlugFromRoute = computed(() => {
    const workspaceSlug = extractWorkspaceSlugFromSurfacePathname(
      placementContext.value,
      currentSurfaceId.value,
      routePath.value
    );
    return String(workspaceSlug || "").trim();
  });

  return Object.freeze({
    route,
    routePath,
    placementContext,
    mergePlacementContext,
    currentSurfaceId,
    workspaceSlugFromRoute
  });
}

export { useWorkspaceRouteContext };
