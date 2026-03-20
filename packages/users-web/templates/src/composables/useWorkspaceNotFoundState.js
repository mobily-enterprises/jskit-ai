import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

function useWorkspaceNotFoundState() {
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();

  const routeWorkspaceSlug = computed(() =>
    String(route?.params?.workspaceSlug || "")
      .trim()
      .toLowerCase()
  );

  const workspaceBootstrapStatus = computed(() => {
    const statuses =
      placementContext.value?.workspaceBootstrapStatuses &&
      typeof placementContext.value.workspaceBootstrapStatuses === "object"
        ? placementContext.value.workspaceBootstrapStatuses
        : {};
    return String(statuses[routeWorkspaceSlug.value] || "")
      .trim()
      .toLowerCase();
  });

  const workspaceNotFound = computed(() => workspaceBootstrapStatus.value === "not_found");

  return Object.freeze({
    routeWorkspaceSlug,
    workspaceBootstrapStatus,
    workspaceNotFound
  });
}

export { useWorkspaceNotFoundState };
