import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveRuntimePathname,
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { resolveWorkspaceSurfaceIdFromPlacementPathname } from "../lib/workspaceSurfacePaths.js";

function useSurfaceRouteContext() {
  const route = useRoute();
  const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
  const routePath = computed(() => resolveRuntimePathname(route?.path));

  const currentSurfaceId = computed(() => {
    return (
      resolveWorkspaceSurfaceIdFromPlacementPathname(placementContext.value, routePath.value) ||
      resolveSurfaceIdFromPlacementPathname(placementContext.value, routePath.value)
    );
  });

  return Object.freeze({
    route,
    routePath,
    placementContext,
    mergePlacementContext,
    currentSurfaceId
  });
}

export { useSurfaceRouteContext };
