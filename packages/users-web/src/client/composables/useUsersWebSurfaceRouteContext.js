import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function useUsersWebSurfaceRouteContext() {
  const route = useRoute();
  const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();

  const currentSurfaceId = computed(() => {
    return resolveSurfaceIdFromPlacementPathname(placementContext.value, route.path);
  });

  return Object.freeze({
    route,
    placementContext,
    mergePlacementContext,
    currentSurfaceId
  });
}

export { useUsersWebSurfaceRouteContext };
