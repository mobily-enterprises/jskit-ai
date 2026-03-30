import { computed } from "vue";
import { useRoute } from "vue-router";
import { normalizeLowerText, normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";

const STATUS_MESSAGES = {
  not_found: "The requested workspace was not found.",
  forbidden: "You do not have access to this workspace.",
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

  return Object.freeze({
    routeWorkspaceSlug,
    workspaceBootstrapStatus,
    workspaceUnavailable,
    workspaceUnavailableMessage
  });
}

export { useWorkspaceNotFoundState };
