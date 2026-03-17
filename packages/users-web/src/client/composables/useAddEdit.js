import { proxyRefs } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useOperationScope } from "./internal/useOperationScope.js";
import { useUiFeedback } from "./useUiFeedback.js";
import { useFieldErrorBag } from "./useFieldErrorBag.js";
import {
  setupRouteChangeCleanup,
  setupOperationErrorReporting
} from "./operationUiHelpers.js";
import {
  resolveResourceMessages
} from "./scopeHelpers.js";

function useAddEdit({
  visibility = "workspace",
  access = "auto",
  resource = null,
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.add-edit",
  fallbackLoadError = "Unable to load resource.",
  fallbackSaveError = "Unable to save resource.",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  parseInput,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload,
  onSaveSuccess,
  messages = {},
  realtime = null
} = {}) {
  const operationScope = useOperationScope({
    visibility,
    access,
    placementSource,
    apiSuffix,
    model,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions,
      save: savePermissions
    },
    realtime
  });
  const routeContext = operationScope.routeContext;
  const resolvedMessages = resolveResourceMessages(resource, {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Saved.",
    saveError: "Unable to save."
  });
  const customMessages = messages && typeof messages === "object" ? messages : {};
  const effectiveMessages = {
    ...resolvedMessages,
    ...customMessages
  };

  const canView = operationScope.permissionGate("view");
  const canSave = operationScope.permissionGate("save");

  const endpointResource = useEndpointResource({
    queryKey: operationScope.queryKey,
    path: operationScope.apiPath,
    enabled: () =>
      operationScope.queryEnabled.value &&
      operationScope.hasRouteWorkspaceSlug.value &&
      Boolean(operationScope.apiPath.value) &&
      canView.value,
    readMethod,
    writeMethod,
    fallbackLoadError,
    fallbackSaveError: String(fallbackSaveError || effectiveMessages.saveError || "Unable to save resource.")
  });

  const feedback = useUiFeedback({
    source: `${placementSource}.feedback`
  });
  const fieldBag = useFieldErrorBag(fieldErrorKeys);

  const addEdit = useAddEditCore({
    model,
    resource: endpointResource,
    queryKey: operationScope.queryKey,
    canSave,
    fieldBag,
    feedback,
    parseInput,
    mapLoadedToModel,
    buildRawPayload,
    buildSavePayload,
    onSaveSuccess,
    messages: effectiveMessages
  });

  setupRouteChangeCleanup({
    enabled: clearOnRouteChange,
    route: routeContext.route,
    feedback,
    fieldBag
  });

  const loadError = operationScope.loadError(endpointResource.loadError);
  const isLoading = operationScope.isLoading(endpointResource.isLoading);
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError
  });

  return proxyRefs({
    canView,
    canSave,
    loadError,
    isLoading,
    isSaving: addEdit.saving,
    fieldErrors: addEdit.fieldErrors,
    message: addEdit.message,
    messageType: addEdit.messageType,
    submit: addEdit.submit,
    refresh: endpointResource.reload,
    resource: endpointResource
  });
}

export { useAddEdit };
