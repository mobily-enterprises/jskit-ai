import { computed } from "vue";
import { useRoute } from "vue-router";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

const STATUS_MESSAGES = {
  not_found: "The requested workspace was not found.",
  forbidden: "You do not have access to this workspace.",
  unauthenticated: "You need to sign in to access this workspace.",
  error: "Workspace data could not be loaded right now."
};

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

  const workspaceUnavailable = computed(
    () => Boolean(workspaceBootstrapStatus.value) && workspaceBootstrapStatus.value !== "resolved"
  );
  const workspaceUnavailableMessage = computed(
    () => STATUS_MESSAGES[workspaceBootstrapStatus.value] || "Workspace is currently unavailable."
  );

  return Object.freeze({
    routeWorkspaceSlug,
    workspaceBootstrapStatus,
    workspaceUnavailable,
    workspaceUnavailableMessage
  });
}

export { useWorkspaceNotFoundState };
