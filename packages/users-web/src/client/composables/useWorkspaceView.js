import { computed } from "vue";
import { useViewCore } from "./useViewCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebWorkspaceAccess } from "./useUsersWebWorkspaceAccess.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import {
  normalizePermissions,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForWorkspace
} from "./scopeHelpers.js";

function useWorkspaceView({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readMethod = "GET",
  readEnabled = true,
  placementSource = "users-web.workspace.view",
  missingWorkspaceSlugError = "Workspace slug is required in the URL.",
  fallbackLoadError = "Unable to load resource.",
  notFoundStatuses = [404],
  notFoundMessage = "Record not found.",
  model,
  mapLoadedToModel
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
    placementSource: String(placementSource || "users-web.workspace.view")
  });

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedViewPermissions);
  });

  const resource = useUsersWebEndpointResource({
    queryKey,
    path: workspaceApiPath,
    enabled: computed(
      () => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(workspaceApiPath.value) && canView.value
    ),
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
    if (!hasRouteWorkspaceSlug.value) {
      return String(missingWorkspaceSlugError || "Workspace slug is required in the URL.");
    }

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

export { useWorkspaceView };
