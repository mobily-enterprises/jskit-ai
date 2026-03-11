import { computed } from "vue";
import { useListCore } from "./useListCore.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix,
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
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const routeContext = workspaceScoped ? useUsersWebWorkspaceRouteContext() : useUsersWebSurfaceRouteContext();

  const workspaceSlugFromRoute = workspaceScoped ? routeContext.workspaceSlugFromRoute : computed(() => "");
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));
  const normalizedViewPermissions = normalizePermissions(viewPermissions);

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility
    });

    if (workspaceScoped) {
      return routeContext.resolveWorkspaceApiPath(suffix);
    }

    return normalizeApiPath(suffix);
  });

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

  const access = useUsersWebAccess({
    workspaceSlug: workspaceScoped ? workspaceSlugFromRoute : "",
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext: routeContext.mergePlacementContext,
    placementSource: String(placementSource || "users-web.list")
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
    if (workspaceScoped && !hasRouteWorkspaceSlug.value) {
      throw new Error("useList requires route.params.workspaceSlug when visibility is workspace/workspace_user.");
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

export { useList };
