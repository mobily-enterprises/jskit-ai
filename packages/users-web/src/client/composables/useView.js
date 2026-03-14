import { computed } from "vue";
import { useViewCore } from "./useViewCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useScopeRuntime } from "./useScopeRuntime.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey
} from "./scopeHelpers.js";

function useView({
  visibility = "workspace",
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
  mapLoadedToModel
} = {}) {
  const normalizedViewPermissions = normalizePermissions(viewPermissions);
  const scopeRuntime = useScopeRuntime({
    visibility,
    access,
    hasPermissionRequirements: normalizedViewPermissions.length > 0,
    placementSource
  });
  const normalizedVisibility = scopeRuntime.normalizedVisibility;
  const routeContext = scopeRuntime.routeContext;
  const workspaceSlugFromRoute = scopeRuntime.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const scopeAccess = scopeRuntime.access;

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
    return resolvePermissionAccess(scopeAccess, normalizedViewPermissions);
  });

  const resource = useEndpointResource({
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
    if (scopeRuntime.workspaceRouteError.value) {
      return scopeRuntime.workspaceRouteError.value;
    }

    if (scopeAccess.bootstrapError.value) {
      return scopeAccess.bootstrapError.value;
    }

    return view.loadError.value;
  });

  const isLoading = computed(() => Boolean(view.isLoading.value || scopeAccess.isBootstrapping.value));
  const isFetching = computed(() => Boolean(view.isFetching.value || scopeAccess.isBootstrapping.value));

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
