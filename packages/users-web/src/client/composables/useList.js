import { computed } from "vue";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useListCore } from "./useListCore.js";
import { resolveOperationAdapter } from "./operationAdapters.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";
import { createListUiRuntime } from "./listUiRuntime.js";

function useList({
  ownershipFilter = USERS_ROUTE_VISIBILITY_WORKSPACE,
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
  realtime = null,
  adapter = null,
  recordIdParam = "recordId",
  recordIdSelector = null,
  viewUrlTemplate = "",
  editUrlTemplate = ""
} = {}) {
  const operationAdapter = resolveOperationAdapter(adapter, {
    context: "useList adapter"
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

  const isInitialLoading = operationScope.isLoading(list.isInitialLoading);
  const isFetching = operationScope.isLoading(list.isFetching);
  const isRefetching = computed(() => Boolean(isFetching.value && !isInitialLoading.value));
  const loadError = operationScope.loadError(list.loadError);
  const isLoading = operationScope.isLoading(list.isLoading);
  const listUiRuntime = createListUiRuntime({
    items: list.items,
    isInitialLoading,
    recordIdParam,
    recordIdSelector,
    routeParams: computed(() => operationScope.routeContext.route?.params || {}),
    viewUrlTemplate,
    editUrlTemplate
  });
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
    isInitialLoading,
    isFetching,
    isRefetching,
    isLoading,
    isLoadingMore: list.isLoadingMore,
    hasMore: list.hasMore,
    loadError,
    pages: list.pages,
    items: list.items,
    reload: list.reload,
    loadMore: list.loadMore,
    hasViewUrl: listUiRuntime.hasViewUrl,
    hasEditUrl: listUiRuntime.hasEditUrl,
    actionColumnCount: listUiRuntime.actionColumnCount,
    showListSkeleton: listUiRuntime.showListSkeleton,
    resolveRowKey: listUiRuntime.resolveRowKey,
    resolveViewUrl: listUiRuntime.resolveViewUrl,
    resolveEditUrl: listUiRuntime.resolveEditUrl
  });
}

export { useList };
