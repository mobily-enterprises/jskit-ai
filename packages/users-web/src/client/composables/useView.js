import { computed } from "vue";
import { useViewCore } from "./useViewCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebScopeRuntime } from "./useUsersWebScopeRuntime.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey
} from "./scopeHelpers.js";

function useView({
  visibility = "workspace",
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
  mapLoadedToModel
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

  const resource = useUsersWebEndpointResource({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(apiPath.value) && canView.value),
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

  const loadError = computed(() => {
    scopeRuntime.requireWorkspaceRouteParam("useView");

    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return view.loadError.value;
  });

  const isLoading = computed(() => Boolean(view.isLoading.value || access.isBootstrapping.value));
  const isFetching = computed(() => Boolean(view.isFetching.value || access.isBootstrapping.value));

  return Object.freeze({
    record: view.record,
    canView,
    isLoading,
    isFetching,
    isNotFound: view.isNotFound,
    notFoundError: view.notFoundError,
    loadError,
    refresh: view.refresh,
    resource
  });
}

export { useView };
