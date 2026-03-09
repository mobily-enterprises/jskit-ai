import { computed } from "vue";
import { useListCore } from "./useListCore.js";
import { useUsersWebWorkspaceAccess } from "./useUsersWebWorkspaceAccess.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import {
  normalizePermissions,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForWorkspace
} from "./scopeHelpers.js";

function useWorkspaceList({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readEnabled = true,
  placementSource = "users-web.workspace.list",
  missingWorkspaceSlugError = "Workspace slug is required in the URL.",
  fallbackLoadError = "Unable to load list.",
  pageParamName = "cursor",
  initialPageParam = null,
  getNextPageParam,
  selectItems,
  requestOptions,
  queryOptions
} = {}) {
  const { currentSurfaceId, workspaceSlugFromRoute, resolveWorkspaceApiPath, mergePlacementContext } =
    useUsersWebWorkspaceRouteContext();

  const normalizedViewPermissions = normalizePermissions(viewPermissions);
  const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));

  const workspaceApiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value
    });

    return resolveWorkspaceApiPath(suffix);
  });

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value
    })
  );

  const queryKey = computed(() =>
    resolveQueryKeyForWorkspace(queryKeyFactory, currentSurfaceId.value, workspaceSlugFromRoute.value)
  );

  const access = useUsersWebWorkspaceAccess({
    workspaceSlug: workspaceSlugFromRoute,
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.workspace.list")
  });

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedViewPermissions);
  });

  const list = useListCore({
    queryKey,
    path: workspaceApiPath,
    enabled: computed(
      () => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(workspaceApiPath.value) && canView.value
    ),
    pageParamName,
    initialPageParam,
    getNextPageParam,
    selectItems,
    requestOptions,
    queryOptions,
    fallbackLoadError
  });

  const loadError = computed(() => {
    if (!hasRouteWorkspaceSlug.value) {
      return String(missingWorkspaceSlugError || "Workspace slug is required in the URL.");
    }

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

export { useWorkspaceList };
