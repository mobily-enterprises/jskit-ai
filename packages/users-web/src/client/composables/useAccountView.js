import { computed } from "vue";
import { useViewCore } from "./useViewCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForScope
} from "./scopeHelpers.js";

function useAccountView({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  readMethod = "GET",
  readEnabled = true,
  placementSource = "users-web.account.view",
  fallbackLoadError = "Unable to load resource.",
  notFoundStatuses = [404],
  notFoundMessage = "Record not found.",
  model,
  mapLoadedToModel
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
    placementSource: String(placementSource || "users-web.account.view")
  });

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedViewPermissions);
  });

  const resource = useUsersWebEndpointResource({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && Boolean(apiPath.value) && canView.value),
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

export { useAccountView };
