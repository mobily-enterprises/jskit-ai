import { computed, watch } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebWorkspaceAccess } from "./useUsersWebWorkspaceAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import {
  normalizePermissions,
  resolveApiSuffix
} from "./scopeHelpers.js";

function useWorkspaceCommand({
  apiSuffix = "",
  runPermissions = [],
  writeMethod = "POST",
  placementSource = "users-web.workspace.command",
  missingWorkspaceSlugError = "Workspace slug is required in the URL.",
  fallbackRunError = "Unable to complete action.",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  parseInput,
  buildRawPayload,
  buildCommandPayload,
  buildCommandOptions,
  onRunSuccess,
  onRunError,
  messages = {}
} = {}) {
  const { route, currentSurfaceId, workspaceSlugFromRoute, resolveWorkspaceApiPath, mergePlacementContext } =
    useUsersWebWorkspaceRouteContext();

  const normalizedPermissions = normalizePermissions(runPermissions);
  const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));

  const workspaceApiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      model
    });

    return resolveWorkspaceApiPath(suffix);
  });

  const access = useUsersWebWorkspaceAccess({
    workspaceSlug: workspaceSlugFromRoute,
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.workspace.command")
  });

  const canRun = computed(() => {
    if (normalizedPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedPermissions);
  });

  const resource = useUsersWebEndpointResource({
    path: workspaceApiPath,
    enabled: false,
    writeMethod,
    fallbackSaveError: fallbackRunError
  });

  const feedback = useUsersWebUiFeedback();
  const fieldBag = useUsersWebFieldErrorBag(fieldErrorKeys);

  const command = useCommandCore({
    model,
    resource,
    canRun,
    fieldBag,
    feedback,
    parseInput,
    buildRawPayload,
    buildCommandPayload,
    buildCommandOptions,
    onRunSuccess,
    onRunError,
    messages: {
      validation: "Fix invalid values and try again.",
      success: "Completed.",
      error: String(fallbackRunError || "Unable to complete action."),
      ...(messages && typeof messages === "object" ? messages : {})
    }
  });

  if (clearOnRouteChange) {
    watch(
      () => route.fullPath,
      () => {
        feedback.clear();
        fieldBag.clear();
      }
    );
  }

  const loadError = computed(() => {
    if (!hasRouteWorkspaceSlug.value) {
      return String(missingWorkspaceSlugError || "Workspace slug is required in the URL.");
    }

    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return "";
  });

  const isLoading = computed(() => Boolean(access.isBootstrapping.value));

  return Object.freeze({
    canRun,
    isLoading,
    loadError,
    isRunning: command.running,
    fieldErrors: command.fieldErrors,
    message: command.message,
    messageType: command.messageType,
    run: command.run,
    resource
  });
}

export { useWorkspaceCommand };
