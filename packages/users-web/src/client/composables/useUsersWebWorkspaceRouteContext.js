import { computed } from "vue";
import {
  extractWorkspaceSlugFromSurfacePathname
} from "@jskit-ai/shell-web/client/placement";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";

function useUsersWebWorkspaceRouteContext() {
  const { route, placementContext, mergePlacementContext, currentSurfaceId } = useUsersWebSurfaceRouteContext();
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

export { useUsersWebWorkspaceRouteContext };
