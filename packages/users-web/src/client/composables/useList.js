import { computed } from "vue";
import { useListCore } from "./useListCore.js";
import { useUsersWebScopeRuntime } from "./useUsersWebScopeRuntime.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey
} from "./scopeHelpers.js";

function useList({
  visibility = "workspace",
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
  const scopeRuntime = useUsersWebScopeRuntime({
    visibility,
    placementSource
  });
  const normalizedVisibility = scopeRuntime.normalizedVisibility;
  const routeContext = scopeRuntime.routeContext;
  const workspaceSlugFromRoute = scopeRuntime.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const access = scopeRuntime.access;
  const normalizedViewPermissions = normalizePermissions(viewPermissions);

  const apiPath = computed(() => scopeRuntime.resolveApiPath(apiSuffix));

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility
    })
  );

  const queryKey = computed(() =>
    resolveQueryKey(queryKeyFactory, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility
    })
  );

  const canView = computed(() => {
    return resolvePermissionAccess(access, normalizedViewPermissions);
  });

  const list = useListCore({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(apiPath.value) && canView.value),
    pageParamName,
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });

  const loadError = computed(() => {
    scopeRuntime.requireWorkspaceRouteParam("useList");

    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return list.loadError.value;
  });

  const isLoading = computed(() => Boolean(list.isLoading.value || access.isBootstrapping.value));

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
