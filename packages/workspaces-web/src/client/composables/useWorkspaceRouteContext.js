import { computed } from "vue";
import { useSurfaceRouteContext } from "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext";
import { readWorkspaceRouteScope } from "../support/workspaceScopeSupport.js";

/** The surface route context, with the workspace the route names. */
function useWorkspaceRouteContext() {
  const routeContext = useSurfaceRouteContext();
  const workspaceSlugFromRoute = computed(() => {
    return readWorkspaceRouteScope(routeContext).workspaceSlug;
  });

  return {
    route: routeContext.route,
    routePath: routeContext.routePath,
    placementContext: routeContext.placementContext,
    mergePlacementContext: routeContext.mergePlacementContext,
    currentSurfaceId: routeContext.currentSurfaceId,
    workspaceSlugFromRoute
  };
}

export { useWorkspaceRouteContext };
