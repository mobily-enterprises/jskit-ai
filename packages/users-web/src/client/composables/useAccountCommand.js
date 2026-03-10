import { computed, watch, proxyRefs } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  resolveApiSuffix
} from "./scopeHelpers.js";

function useAccountCommand({
  apiSuffix = "",
  runPermissions = [],
  writeMethod = "POST",
  placementSource = "users-web.account.command",
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
  const { route, currentSurfaceId, mergePlacementContext } = useUsersWebSurfaceRouteContext();

  const normalizedPermissions = normalizePermissions(runPermissions);

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value,
      model
    });

    return normalizeApiPath(suffix);
  });

  const access = useUsersWebAccess({
    workspaceSlug: "",
    enabled: true,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.account.command")
  });

  const canRun = computed(() => {
    if (normalizedPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedPermissions);
  });

  const resource = useUsersWebEndpointResource({
    path: apiPath,
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
    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return "";
  });

  const isLoading = computed(() => Boolean(access.isBootstrapping.value));

  return proxyRefs({
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

export { useAccountCommand };
