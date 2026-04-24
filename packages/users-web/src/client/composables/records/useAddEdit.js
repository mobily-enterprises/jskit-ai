import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { useAddEditCore } from "../runtime/useAddEditCore.js";
import { useEndpointResource } from "../runtime/useEndpointResource.js";
import { resolveOperationAdapter } from "../runtime/operationAdapters.js";
import { createAddEditUiRuntime } from "../runtime/addEditUiRuntime.js";
import { useUiFeedback } from "../runtime/useUiFeedback.js";
import { useFieldErrorBag } from "../runtime/useFieldErrorBag.js";
import {
  setupRouteChangeCleanup,
  setupOperationErrorReporting
} from "../runtime/operationUiHelpers.js";
import {
  resolveResourceMessages
} from "../support/scopeHelpers.js";
import { createRequestQueryRuntime } from "../support/requestQueryRuntimeSupport.js";
import { resolveRouteParamNamesInOrder } from "../support/routeTemplateHelpers.js";

function useAddEdit({
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
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
  requestQueryParams = null,
  recordIdParam = "recordId",
  routeParams = null,
  routeRecordId = null,
  apiUrlTemplate = "",
  viewUrlTemplate = "",
  listUrlTemplate = "",
  saveRecordIdSelector = null,
  messages = {},
  realtime = null,
  adapter = null
} = {}) {
  const route = useRoute();
  const addEditUiRuntime = createAddEditUiRuntime({
    recordIdParam,
    routeParams: routeParams ?? computed(() => route?.params || {}),
    routeParamNames: computed(() => resolveRouteParamNamesInOrder(route)),
    routePath: computed(() => route?.path || ""),
    routeRecordId,
    apiUrlTemplate,
    viewUrlTemplate,
    listUrlTemplate,
    saveRecordIdSelector
  });
  const normalizedApiUrlTemplate = String(apiUrlTemplate || "").trim();
  const effectiveApiSuffix = normalizedApiUrlTemplate ? addEditUiRuntime.apiSuffix : apiSuffix;
  const operationAdapter = resolveOperationAdapter(adapter, {
    context: "useAddEdit adapter"
  });
  const operationScope = operationAdapter.useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
    placementSource,
    apiSuffix: effectiveApiSuffix,
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
  const effectiveMessages = {
    ...resolveResourceMessages(resource, {
      validation: "Fix invalid values and try again.",
      saveSuccess: "Saved.",
      saveError: "Unable to save."
    }),
    ...(messages && typeof messages === "object" ? messages : {})
  };

  const canView = operationScope.permissionGate("view");
  const canSave = operationScope.permissionGate("save");
  const queryCanRun = operationScope.queryCanRun(canView);
  const queryParamsContext = computed(() => {
    return Object.freeze({
      surfaceId: operationScope.routeContext.currentSurfaceId.value,
      scopeParamValue: operationScope.scopeParamValue.value,
      ownershipFilter: operationScope.normalizedOwnershipFilter,
      recordId: addEditUiRuntime.recordId.value,
      model
    });
  });
  const requestQueryRuntime = createRequestQueryRuntime({
    requestQueryParams,
    context: queryParamsContext,
    sourceQueryKey: operationScope.queryKey,
    sourcePath: operationScope.apiPath
  });

  const endpointResource = useEndpointResource({
    queryKey: requestQueryRuntime.queryKey,
    path: requestQueryRuntime.requestPath,
    enabled: queryCanRun,
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
    queryKey: requestQueryRuntime.queryKey,
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

  const isInitialLoading = operationScope.isLoading(endpointResource.isInitialLoading);
  const isFetching = operationScope.isLoading(endpointResource.isFetching);
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const isFieldLocked = computed(() =>
    Boolean(!canSave.value || addEdit.saving.value || isRefetching.value)
  );
  const isSubmitDisabled = computed(() =>
    Boolean(isInitialLoading.value || isRefetching.value || !canSave.value)
  );
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
    isInitialLoading,
    isFetching,
    isRefetching,
    isFieldLocked,
    isSubmitDisabled,
    isLoading,
    isSaving: addEdit.saving,
    fieldErrors: addEdit.fieldErrors,
    message: addEdit.message,
    messageType: addEdit.messageType,
    submit: addEdit.submit,
    refresh: endpointResource.reload,
    resource: endpointResource,
    recordId: addEditUiRuntime.recordId,
    listUrl: addEditUiRuntime.listUrl,
    cancelUrl: addEditUiRuntime.cancelUrl,
    resolveParams: addEditUiRuntime.resolveParams,
    resolveViewUrl: addEditUiRuntime.resolveViewUrl,
    resolveSavedViewUrl: addEditUiRuntime.resolveSavedViewUrl
  });
}

export { useAddEdit };
