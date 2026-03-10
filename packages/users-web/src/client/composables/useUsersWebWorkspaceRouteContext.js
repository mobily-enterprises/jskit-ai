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

  function resolveWorkspaceApiPath(workspaceSuffix = "") {
    const workspaceSlug = String(workspaceSlugFromRoute.value || "").trim();
    const rawSuffix = String(workspaceSuffix || "").trim();
    const normalizedSuffix = rawSuffix ? (rawSuffix.startsWith("/") ? rawSuffix : `/${rawSuffix}`) : "";
    if (!workspaceSlug) {
      return "";
    }

    return `/api/w/${workspaceSlug}/workspace${normalizedSuffix}`;
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
