import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function useUsersWebWorkspaceRouteContext() {
  const route = useRoute();
  const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

  const currentSurfaceId = computed(() => resolveSurfaceIdFromPlacementPathname(placementContext.value, route.path));
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
