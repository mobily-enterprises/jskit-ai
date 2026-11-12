import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import {
  resolveLookupFieldDisplayValue,
  resolveRecordTitle
} from "../crud/crudLookupFieldLabelSupport.js";
import { useViewCore } from "../runtime/useViewCore.js";
import { useEndpointResource } from "../runtime/useEndpointResource.js";
import { useOperationScope } from "../internal/useOperationScope.js";
import {
  createLoadRetryActionFactory,
  setupOperationErrorReporting
} from "../runtime/operationUiHelpers.js";
import { createViewUiRuntime } from "../runtime/viewUiRuntime.js";
import { createRequestQueryRuntime } from "../support/requestQueryRuntimeSupport.js";
import { resolveRouteParamNamesInOrder } from "../support/routeTemplateHelpers.js";
import { resolveOperationRealtimeOptions } from "../useRealtimeQueryInvalidation.js";
import { useJskitText } from "../../i18n.js";

const { t } = useJskitText();

/** @param {import("../../types.js").ViewOptions} options */
function useView({
  resource,
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory,
  viewPermissions = [],
  readMethod = "GET",
  readEnabled = true,
  client,
  transport,
  requestRecovery,
  requestRecoveryLabel = t("jskit.http.resource.label"),
  placementSource = "http-web.view",
  fallbackLoadError = t("jskit.http.resource.loadFailed"),
  notFoundStatuses = [404],
  notFoundMessage = t("jskit.http.crud.recordNotFound"),
  model,
  mapLoadedToModel,
  requestQueryParams,
  requestFieldsets,
  recordIdParam = "recordId",
  routeParams = null,
  routeRecordId,
  apiUrlTemplate = "",
  listUrlTemplate = "",
  editUrlTemplate = "",
  includeRecordIdInQueryKey = false,
  realtime
}) {
  const route = useRoute();
  const viewUiRuntime = createViewUiRuntime({
    recordIdParam,
    routeParams: routeParams ?? computed(() => route?.params || {}),
    routeParamNames: computed(() => resolveRouteParamNamesInOrder(route)),
    routePath: computed(() => route?.path || ""),
    routeRecordId,
    apiUrlTemplate,
    listUrlTemplate,
    editUrlTemplate
  });
  const normalizedApiUrlTemplate = String(apiUrlTemplate || "").trim();
  const effectiveApiSuffix = normalizedApiUrlTemplate ? viewUiRuntime.apiSuffix : apiSuffix;
  const operationScope = useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
    apiSuffix: effectiveApiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    },
    realtime: resolveOperationRealtimeOptions({
      realtime,
      fallbackRealtime: resource?.operations?.view?.realtime ||
        resource?.operations?.list?.realtime ||
        null
    })
  });
  const queryParamsContext = computed(() => {
    return Object.freeze({
      surfaceId: operationScope.routeContext.currentSurfaceId.value,
      scopeParamValue: operationScope.scopeParamValue.value,
      ownershipFilter: operationScope.normalizedOwnershipFilter,
      recordId: viewUiRuntime.recordId.value
    });
  });
  const baseQueryKey = computed(() => {
    const source = Array.isArray(operationScope.queryKey.value) ? operationScope.queryKey.value : [];
    const next = [...source];
    if (!includeRecordIdInQueryKey) {
      return next;
    }

    const recordIdToken = String(viewUiRuntime.recordId.value || "").trim();
    return [...next, recordIdToken];
  });
  const requestQueryRuntime = createRequestQueryRuntime({
    requestQueryParams,
    requestFieldsets,
    context: queryParamsContext,
    sourceQueryKey: baseQueryKey
  });
  const canView = operationScope.permissionGate("view");

  const endpointResource = useEndpointResource({
    queryKey: requestQueryRuntime.queryKey,
    path: operationScope.apiPath,
    enabled: operationScope.queryCanRun(canView),
    client,
    readMethod,
    readQuery: requestQueryRuntime.requestQuery,
    transport,
    requestRecovery,
    requestRecoveryLabel,
    refreshOnPull: true,
    fallbackLoadError
  });

  const view = useViewCore({
    resource: endpointResource,
    model,
    canView,
    mapLoadedToModel,
    notFoundStatuses,
    notFoundMessage
  });

  const loadError = operationScope.loadError(view.loadError);
  const isLoading = operationScope.isLoading(view.isLoading);
  const isFetching = operationScope.isLoading(view.isFetching);
  const isRefetching = computed(() => Boolean(isFetching.value && !isLoading.value));
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError,
    notFoundError: view.notFoundError,
    dedupeWindowMs: 0,
    loadActionFactory: createLoadRetryActionFactory({
      errorStatus: view.errorStatus,
      retry: view.refresh
    })
  });

  return proxyRefs({
    record: view.record,
    recordId: viewUiRuntime.recordId,
    listUrl: viewUiRuntime.listUrl,
    editUrl: viewUiRuntime.editUrl,
    resolveParams: viewUiRuntime.resolveParams,
    canView,
    isLoading,
    isFetching,
    isRefetching,
    errorStatus: view.errorStatus,
    isNotFound: view.isNotFound,
    notFoundError: view.notFoundError,
    loadError,
    loadRefusalMessage: view.loadRefusalMessage,
    refresh: view.refresh,
    resource: endpointResource,
    resolveFieldDisplay: resolveLookupFieldDisplayValue,
    resolveRecordTitle
  });
}

export { useView };
