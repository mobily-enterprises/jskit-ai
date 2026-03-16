import { computed } from "vue";
import {
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import { useSurfaceRouteContext } from "./useSurfaceRouteContext.js";

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
