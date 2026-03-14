import { useViewCore } from "./useViewCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useOperationScope } from "./internal/useOperationScope.js";

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
  const operationScope = useOperationScope({
    visibility,
    access,
    placementSource,
    apiSuffix,
    readEnabled,
    queryKeyFactory,
    permissionSets: {
      view: viewPermissions
    }
  });
  const canView = operationScope.permissionGate("view");

  const resource = useEndpointResource({
    queryKey: operationScope.queryKey,
    path: operationScope.apiPath,
    enabled: () =>
      operationScope.queryEnabled.value &&
      operationScope.hasRouteWorkspaceSlug.value &&
      Boolean(operationScope.apiPath.value) &&
      canView.value,
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

  const loadError = operationScope.loadError(view.loadError);
  const isLoading = operationScope.isLoading(view.isLoading);
  const isFetching = operationScope.isLoading(view.isFetching);

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
