import { useListCore } from "./useListCore.js";
import { useOperationScope } from "./internal/useOperationScope.js";

function useList({
  visibility = "workspace",
  access = "auto",
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readEnabled = true,
  placementSource = "users-web.list",
  fallbackLoadError = "Unable to load list.",
  pageParamName = "cursor",
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions,
  queryOptions
} = {}) {
  const operationScope = useOperationScope({
    visibility,
    access,
    placementSource,
    apiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    }
  });
  const canView = operationScope.permissionGate("view");

  const list = useListCore({
    queryKey: operationScope.queryKey,
    path: operationScope.apiPath,
    enabled: () =>
      operationScope.queryEnabled.value &&
      operationScope.hasRouteWorkspaceSlug.value &&
      Boolean(operationScope.apiPath.value) &&
      canView.value,
    pageParamName,
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });

  const loadError = operationScope.loadError(list.loadError);
  const isLoading = operationScope.isLoading(list.isLoading);

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
