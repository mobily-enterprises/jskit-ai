import { computed, proxyRefs } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useScopeRuntime } from "./useScopeRuntime.js";
import { useUiFeedback } from "./useUiFeedback.js";
import { useFieldErrorBag } from "./useFieldErrorBag.js";
import { setupRouteChangeCleanup } from "./operationUiHelpers.js";
import { normalizePermissions, resolvePermissionAccess } from "./scopeHelpers.js";

function useCommand({
  visibility = "workspace",
  access = "auto",
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
  const normalizedPermissions = normalizePermissions(runPermissions);
  const scopeRuntime = useScopeRuntime({
    visibility,
    access,
    hasPermissionRequirements: normalizedPermissions.length > 0,
    placementSource
  });
  const routeContext = scopeRuntime.routeContext;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const scopeAccess = scopeRuntime.access;

  const apiPath = computed(() =>
    scopeRuntime.resolveApiPath(apiSuffix, {
      model
    })
  );

  const canRun = computed(() => {
    return resolvePermissionAccess(scopeAccess, normalizedPermissions);
  });

  const resource = useEndpointResource({
    path: apiPath,
    enabled: false,
    writeMethod,
    fallbackSaveError: fallbackRunError
  });

  const feedback = useUiFeedback();
  const fieldBag = useFieldErrorBag(fieldErrorKeys);

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
    if (scopeRuntime.workspaceRouteError.value) {
      return scopeRuntime.workspaceRouteError.value;
    }

    if (scopeAccess.bootstrapError.value) {
      return scopeAccess.bootstrapError.value;
    }

    return "";
  });

  const isLoading = computed(() => Boolean(scopeAccess.isBootstrapping.value));

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
