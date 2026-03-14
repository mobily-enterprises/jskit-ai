import { computed } from "vue";
import {
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import { useSurfaceRouteContext } from "./useSurfaceRouteContext.js";

function useWorkspaceRouteContext() {
  const { route, placementContext, mergePlacementContext, currentSurfaceId } = useSurfaceRouteContext();
  const workspaceSlugFromRoute = computed(() => {
    const workspaceSlug = extractWorkspaceSlugFromSurfacePathname(
      placementContext.value,
      currentSurfaceId.value,
      route.path
    );
    return String(workspaceSlug || "").trim();
  });

  return Object.freeze({
    route,
    placementContext,
    mergePlacementContext,
    currentSurfaceId,
    workspaceSlugFromRoute
  });
}

export { useWorkspaceRouteContext };
