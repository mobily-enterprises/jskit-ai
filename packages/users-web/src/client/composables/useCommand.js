import { proxyRefs } from "vue";
import { useCommandCore } from "./useCommandCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useOperationScope } from "./internal/useOperationScope.js";
import { useUiFeedback } from "./useUiFeedback.js";
import { useFieldErrorBag } from "./useFieldErrorBag.js";
import {
  setupRouteChangeCleanup,
  setupOperationErrorReporting
} from "./operationUiHelpers.js";

function useCommand({
  visibility = "workspace",
  surfaceId = "",
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
  suppressSuccessMessage = false,
  messages = {},
  realtime = null
} = {}) {
  const operationScope = useOperationScope({
    visibility,
    surfaceId,
    access,
    placementSource,
    apiSuffix,
    model,
    readEnabled: false,
    permissionSets: {
      run: runPermissions
    },
    realtime
  });
  const routeContext = operationScope.routeContext;
  const canRun = operationScope.permissionGate("run");

  const resource = useEndpointResource({
    path: operationScope.apiPath,
    enabled: false,
    writeMethod,
    fallbackSaveError: fallbackRunError
  });

  const feedback = useUiFeedback({
    source: `${placementSource}.feedback`
  });
  const fieldBag = useFieldErrorBag(fieldErrorKeys);

  const command = useCommandCore({
    model,
    resource,
    writeMethod,
    canRun,
    fieldBag,
    feedback,
    parseInput,
    buildRawPayload,
    buildCommandPayload,
    buildCommandOptions,
    onRunSuccess,
    onRunError,
    suppressSuccessMessage: Boolean(suppressSuccessMessage),
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

  const loadError = operationScope.loadError();
  const isLoading = operationScope.isLoading();
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError
  });

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
