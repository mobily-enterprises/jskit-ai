import { proxyRefs } from "vue";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommandCore } from "./runtime/useCommandCore.js";
import { useEndpointResource } from "./runtime/useEndpointResource.js";
import { useOperationScope } from "./internal/useOperationScope.js";
import { useUiFeedback } from "./runtime/useUiFeedback.js";
import { useFieldErrorBag } from "./runtime/useFieldErrorBag.js";
import {
  setupRouteChangeCleanup,
  setupOperationErrorReporting
} from "./runtime/operationUiHelpers.js";
import { resolveCrudHttpClient } from "./crud/crudHttpClientSupport.js";

function useCommand({
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  runPermissions = [],
  writeMethod = "POST",
  client = null,
  resource: commandResource = null,
  transport = null,
  placementSource = "http-web.command",
  fallbackRunError = "jskit.http.feedback.actionFailed",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  input,
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
    ownershipFilter,
    surfaceId,
    access,
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

  const endpointResource = useEndpointResource({
    path: operationScope.apiPath,
    enabled: false,
    client: resolveCrudHttpClient(commandResource, { client }),
    writeMethod,
    transport,
    fallbackSaveError: fallbackRunError
  });

  const feedback = useUiFeedback({
    source: `${placementSource}.feedback`
  });
  const fieldBag = useFieldErrorBag(fieldErrorKeys);

  const command = useCommandCore({
    model,
    resource: endpointResource,
    writeMethod,
    canRun,
    fieldBag,
    feedback,
    input,
    buildRawPayload,
    buildCommandPayload,
    buildCommandOptions,
    onRunSuccess,
    onRunError,
    suppressSuccessMessage: Boolean(suppressSuccessMessage),
    messages: {
      // Keys, rendered when shown so they follow a language switch.
      validation: "jskit.http.feedback.fixInvalidValues",
      success: "jskit.http.feedback.completed",
      error: String(fallbackRunError || "jskit.http.feedback.actionFailed"),
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
    resource: endpointResource
  });
}

export { useCommand };
