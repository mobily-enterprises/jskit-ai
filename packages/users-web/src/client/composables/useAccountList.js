import { computed } from "vue";
import { useListCore } from "./useListCore.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForScope
} from "./scopeHelpers.js";

function useAccountList({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readEnabled = true,
  placementSource = "users-web.account.list",
  fallbackLoadError = "Unable to load list.",
  pageParamName = "cursor",
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions,
  queryOptions
} = {}) {
  const { currentSurfaceId, mergePlacementContext } = useUsersWebSurfaceRouteContext();

  const normalizedViewPermissions = normalizePermissions(viewPermissions);

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value
    });

    return normalizeApiPath(suffix);
  });

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: currentSurfaceId.value
    })
  );

  const queryKey = computed(() => resolveQueryKeyForScope(queryKeyFactory, currentSurfaceId.value));

  const access = useUsersWebAccess({
    workspaceSlug: "",
    enabled: true,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.account.list")
  });

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedViewPermissions);
  });

  const list = useListCore({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && Boolean(apiPath.value) && canView.value),
    pageParamName,
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });

  const loadError = computed(() => {
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

export { useAccountList };
