import { computed } from "vue";
import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext
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

  function resolveWorkspaceApiPath(workspaceSuffix = "") {
    const currentSurface = String(currentSurfaceId.value || "").trim();
    const workspaceSlug = String(workspaceSlugFromRoute.value || "").trim();
    const suffix = String(workspaceSuffix || "");
    if (!currentSurface || !workspaceSlug) {
      return "";
    }

    return resolveSurfaceApiPathFromPlacementContext(
      placementContext.value,
      currentSurface,
      `/w/${workspaceSlug}/workspace${suffix}`
    );
  }

  return Object.freeze({
    route,
    placementContext,
    mergePlacementContext,
    currentSurfaceId,
    workspaceSlugFromRoute,
    resolveWorkspaceApiPath
  });
}

export { useUsersWebWorkspaceRouteContext };
