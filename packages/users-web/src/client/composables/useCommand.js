import { computed, proxyRefs } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebScopeRuntime } from "./useUsersWebScopeRuntime.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { setupRouteChangeCleanup } from "./operationUiHelpers.js";
import { normalizePermissions, resolvePermissionAccess } from "./scopeHelpers.js";

function useCommand({
  visibility = "workspace",
  apiSuffix = "",
  runPermissions = [],
  writeMethod = "POST",
  placementSource = "users-web.command",
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
  const scopeRuntime = useUsersWebScopeRuntime({
    visibility,
    placementSource
  });
  const routeContext = scopeRuntime.routeContext;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const access = scopeRuntime.access;
  const normalizedPermissions = normalizePermissions(runPermissions);

  const apiPath = computed(() =>
    scopeRuntime.resolveApiPath(apiSuffix, {
      model
    })
  );

  const canRun = computed(() => {
    return resolvePermissionAccess(access, normalizedPermissions);
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

  setupRouteChangeCleanup({
    enabled: clearOnRouteChange,
    route: routeContext.route,
    feedback,
    fieldBag
  });

  const loadError = computed(() => {
    scopeRuntime.requireWorkspaceRouteParam("useCommand");

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

export { useCommand };
