import { useListCore } from "./useListCore.js";
import { useOperationScope } from "./internal/useOperationScope.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";

function useList({
  visibility = "workspace",
  surfaceId = "",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readEnabled = true,
  placementSource = "users-web.list",
  fallbackLoadError = "Unable to load list.",
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions,
  queryOptions,
  realtime = null
} = {}) {
  const operationScope = useOperationScope({
    visibility,
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

  const list = useListCore({
    queryKey: operationScope.queryKey,
    path: operationScope.apiPath,
    enabled: operationScope.queryCanRun(canView),
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });

  const loadError = operationScope.loadError(list.loadError);
  const isLoading = operationScope.isLoading(list.isLoading);
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError,
    dedupeWindowMs: 0,
    loadActionFactory: () => ({
      label: "Retry",
      dismissOnRun: true,
      handler() {
        void list.reload();
      }
    })
  });

  return Object.freeze({
    canView,
    isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    loadError,
    pages: list.pages,
    items: list.items,
    reload: list.reload,
    loadMore: list.loadMore
  });
}

export { useList };
