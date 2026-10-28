import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { useAddEditCore } from "../runtime/useAddEditCore.js";
import { useEndpointResource } from "../runtime/useEndpointResource.js";
import { useOperationScope } from "../internal/useOperationScope.js";
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
import { useJskitText } from "../../i18n.js";

const { t } = useJskitText();

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
  client = null,
  transport = null,
  requestRecovery = null,
  requestRecoveryLabel = t("jskit.http.resource.label"),
  placementSource = "http-web.add-edit",
  fallbackLoadError = t("jskit.http.resource.loadFailed"),
  fallbackSaveError = "",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  input,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload,
  onSaveSuccess,
  validationFeedback = true,
  requestQueryParams = null,
  recordIdParam = "recordId",
  routeParams = null,
  routeRecordId = null,
  apiUrlTemplate = "",
  viewUrlTemplate = "",
  listUrlTemplate = "",
  saveRecordIdSelector = null,
  messages = {},
  realtime = null
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
  const operationScope = useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
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
  const resolvedMessages = {
    ...resolveResourceMessages(resource, {
      // Keys, rendered when shown so they follow a language switch.
      validation: "jskit.http.feedback.fixInvalidValues",
      saveSuccess: "jskit.http.feedback.saved",
      saveError: "jskit.http.feedback.saveFailed"
    }),
    ...(messages && typeof messages === "object" ? messages : {})
  };
  // One save-error string for the endpoint and its feedback: an explicit
  // fallbackSaveError, otherwise the resolved resource/messages saveError.
  const effectiveMessages = {
    ...resolvedMessages,
    saveError: String(fallbackSaveError || "").trim() ||
      String(resolvedMessages.saveError || "").trim() ||
      "jskit.http.feedback.saveFailed"
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
    sourceQueryKey: operationScope.queryKey
  });

  const endpointResource = useEndpointResource({
    queryKey: requestQueryRuntime.queryKey,
    path: operationScope.apiPath,
    enabled: queryCanRun,
    client,
    readMethod,
    writeMethod,
    readQuery: requestQueryRuntime.requestQuery,
    transport,
    requestRecovery,
    requestRecoveryLabel,
    fallbackLoadError,
    fallbackSaveError: effectiveMessages.saveError
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
    input,
    mapLoadedToModel,
    buildRawPayload,
    buildSavePayload,
    onSaveSuccess,
    validationFeedback,
    messages: effectiveMessages
  });

  setupRouteChangeCleanup({
    enabled: clearOnRouteChange,
    route: routeContext.route,
    feedback,
    onClear: addEdit.resetValidation
  });

  const isInitialLoading = operationScope.isLoading(endpointResource.isInitialLoading);
  const isFetching = operationScope.isLoading(endpointResource.isFetching);
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const isFieldLocked = computed(() =>
    Boolean(!canSave.value || addEdit.saving.value || isRefetching.value)
  );
  const isSubmitDisabled = computed(() =>
    Boolean(isInitialLoading.value || isRefetching.value || !canSave.value || addEdit.saving.value)
  );
  const loadError = operationScope.loadError(endpointResource.loadError);
  const isLoading = operationScope.isLoading(endpointResource.isLoading);
  const canRetryLoad = computed(() => Boolean(readEnabled !== false && endpointResource?.reload));

  async function refresh() {
    if (!canRetryLoad.value) {
      return null;
    }

    return endpointResource.reload();
  }

  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError,
    dedupeWindowMs: 0,
    loadActionFactory: () => canRetryLoad.value
      ? {
        label: t("jskit.http.actions.retry"),
        dismissOnRun: true,
        handler() {
          void refresh();
        }
      }
      : null
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
    canRetryLoad,
    isLoading,
    isSaving: addEdit.saving,
    fieldErrors: addEdit.fieldErrors,
    validationAttempted: addEdit.validationAttempted,
    validationErrors: addEdit.validationErrors,
    resetValidation: addEdit.resetValidation,
    message: addEdit.message,
    messageType: addEdit.messageType,
    submit: addEdit.submit,
    refresh,
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
