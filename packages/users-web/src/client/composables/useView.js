import { computed } from "vue";
import { useViewCore } from "./useViewCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import { useUsersPaths } from "./useUsersPaths.js";
import {
  normalizePermissions,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix,
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
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const routeContext = workspaceScoped ? useUsersWebWorkspaceRouteContext() : useUsersWebSurfaceRouteContext();
  const usersPaths = useUsersPaths();

  const workspaceSlugFromRoute = workspaceScoped ? routeContext.workspaceSlugFromRoute : computed(() => "");
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));
  const normalizedViewPermissions = normalizePermissions(viewPermissions);

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility
    });
    return usersPaths.api(suffix, {
      visibility: normalizedVisibility,
      workspaceSlug: workspaceSlugFromRoute.value
    });
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
    placementSource: String(placementSource || "users-web.view")
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
    if (workspaceScoped && !hasRouteWorkspaceSlug.value) {
      throw new Error("useView requires route.params.workspaceSlug when visibility is workspace/workspace_user.");
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

export { useView };
