import { computed } from "vue";
import { useRoute } from "vue-router";
import { normalizeLowerText, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

// A workspace the server answers not_found (or forbidden, from an older server) never reaches the surface's pages: the
// shell opens the application's Not found page at its address instead. What is left is a signed-out session or a
// bootstrap that failed.
const STATUS_MESSAGES = {
  unauthenticated: "You need to sign in to access this workspace.",
  error: "Workspace data could not be loaded right now."
};
const DEFAULT_WORKSPACE_UNAVAILABLE_MESSAGE = "Workspace is currently unavailable.";
const RESOLVED_WORKSPACE_STATUS = "resolved";

function useWorkspaceNotFoundState() {
  const route = useRoute();
  const { context: placementContext } = useWebPlacementContext();

  const routeWorkspaceSlug = computed(() => normalizeLowerText(route?.params?.workspaceSlug));

  const workspaceBootstrapStatus = computed(() => {
    const statuses = normalizeObject(placementContext.value?.workspaceBootstrapStatuses);
    return normalizeLowerText(statuses[routeWorkspaceSlug.value]);
  });

  const workspaceUnavailable = computed(
    () => Boolean(workspaceBootstrapStatus.value) && workspaceBootstrapStatus.value !== RESOLVED_WORKSPACE_STATUS
  );
  const workspaceUnavailableMessage = computed(
    () => STATUS_MESSAGES[workspaceBootstrapStatus.value] || DEFAULT_WORKSPACE_UNAVAILABLE_MESSAGE
  );

  return {
    routeWorkspaceSlug,
    workspaceBootstrapStatus,
    workspaceUnavailable,
    workspaceUnavailableMessage
  };
}

export { useWorkspaceNotFoundState };
