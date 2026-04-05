import { computed, proxyRefs } from "vue";
import { useRoute } from "vue-router";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useViewCore } from "./useViewCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { resolveOperationAdapter } from "./operationAdapters.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";
import { createViewUiRuntime } from "./viewUiRuntime.js";
import { resolveLookupFieldDisplayValue, resolveRecordTitle } from "./crudLookupFieldLabelSupport.js";
import { resolveRouteParamNamesInOrder } from "./routeTemplateHelpers.js";

function useView({
  ownershipFilter = USERS_ROUTE_VISIBILITY_WORKSPACE,
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readMethod = "GET",
  readEnabled = true,
  placementSource = "users-web.view",
  fallbackLoadError = "Unable to load resource.",
  notFoundStatuses = [404],
  notFoundMessage = "Record not found.",
  model,
  mapLoadedToModel,
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
  const queryKey = computed(() => {
    const source = Array.isArray(operationScope.queryKey.value) ? operationScope.queryKey.value : [];
    if (!includeRecordIdInQueryKey) {
      return source;
    }

    const recordIdToken = String(viewUiRuntime.recordId.value || "").trim();
    return [...source, recordIdToken];
  });
  const canView = operationScope.permissionGate("view");

  const resource = useEndpointResource({
    queryKey,
    path: operationScope.apiPath,
    enabled: operationScope.queryCanRun(canView),
    readMethod,
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
    resolveFieldDisplay: resolveLookupFieldDisplayValue,
    resolveRecordTitle,
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
