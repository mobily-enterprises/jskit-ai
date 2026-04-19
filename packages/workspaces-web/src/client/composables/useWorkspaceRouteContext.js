import { computed } from "vue";
import { useSurfaceRouteContext } from "@jskit-ai/users-web/client/composables/useSurfaceRouteContext";
import { readWorkspaceRouteScope } from "../support/workspaceScopeSupport.js";

function useWorkspaceRouteContext() {
  const routeContext = useSurfaceRouteContext();
  const workspaceSlugFromRoute = computed(() => {
    return readWorkspaceRouteScope(routeContext).workspaceSlug;
  });

  return Object.freeze({
    ...routeContext,
    workspaceSlugFromRoute
  });
}

export { useWorkspaceRouteContext };
