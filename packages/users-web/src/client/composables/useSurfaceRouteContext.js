import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  resolveSurfaceIdFromPlacementPathname,
  useWebPlacementContext
} from "@jskit-ai/shell-web/client/placement";

function resolveRoutePath(route) {
  const routePath = String(route?.path || "").trim();
  if (routePath) {
    return routePath;
  }

  if (typeof window === "object" && window && window.location) {
    const pathname = String(window.location.pathname || "").trim();
    if (pathname) {
      return pathname;
    }
  }

  return "/";
}

function useSurfaceRouteContext() {
  const route = useRoute();
  const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
  const routePath = computed(() => resolveRoutePath(route));

  const currentSurfaceId = computed(() => {
    return resolveSurfaceIdFromPlacementPathname(placementContext.value, routePath.value);
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
