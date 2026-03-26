import { computed } from "vue";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useViewCore } from "./useViewCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { resolveOperationAdapter } from "./operationAdapters.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";

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
  realtime = null,
  adapter = null
} = {}) {
  const operationAdapter = resolveOperationAdapter(adapter, {
    context: "useView adapter"
  });
  const operationScope = operationAdapter.useOperationScope({
    ownershipFilter,
    surfaceId,
    access,
    placementSource,
    apiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    },
    realtime
  });
  const canView = operationScope.permissionGate("view");

  const resource = useEndpointResource({
    queryKey: operationScope.queryKey,
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

  return Object.freeze({
    record: view.record,
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
