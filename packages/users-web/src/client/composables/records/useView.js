import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { useViewCore } from "../runtime/useViewCore.js";
import { useEndpointResource } from "../runtime/useEndpointResource.js";
import { resolveOperationAdapter } from "../runtime/operationAdapters.js";
import { setupOperationErrorReporting } from "../runtime/operationUiHelpers.js";
import { createViewUiRuntime } from "../runtime/viewUiRuntime.js";
import { createRequestQueryRuntime } from "../support/requestQueryRuntimeSupport.js";
import { resolveRouteParamNamesInOrder } from "../support/routeTemplateHelpers.js";

function useView({
  ownershipFilter = ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readMethod = "GET",
  readEnabled = true,
  transport = null,
  placementSource = "users-web.view",
  fallbackLoadError = "Unable to load resource.",
  notFoundStatuses = [404],
  notFoundMessage = "Record not found.",
  model,
  mapLoadedToModel,
  requestQueryParams = null,
  recordIdParam = "recordId",
  routeParams = null,
  routeRecordId = null,
  apiUrlTemplate = "",
  listUrlTemplate = "",
  editUrlTemplate = "",
  includeRecordIdInQueryKey = false,
  realtime = null,
  adapter = null
} = {}) {
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
  const operationAdapter = resolveOperationAdapter(adapter, {
    context: "useView adapter"
  });
  const operationScope = operationAdapter.useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
    placementSource,
    apiSuffix: effectiveApiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    },
    realtime
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
    context: queryParamsContext,
    sourceQueryKey: baseQueryKey
  });
  const canView = operationScope.permissionGate("view");

  const resource = useEndpointResource({
    queryKey: requestQueryRuntime.queryKey,
    path: operationScope.apiPath,
    enabled: operationScope.queryCanRun(canView),
    readMethod,
    readQuery: requestQueryRuntime.requestQuery,
    transport,
    fallbackLoadError
  });

  const view = useViewCore({
    resource,
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
    loadActionFactory: () => ({
      label: "Retry",
      dismissOnRun: true,
      handler() {
        void view.refresh();
      }
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
    isNotFound: view.isNotFound,
    notFoundError: view.notFoundError,
    loadError,
    refresh: view.refresh,
    resource
  });
}

export { useView };
