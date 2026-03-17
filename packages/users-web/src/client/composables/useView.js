import { useViewCore } from "./useViewCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useOperationScope } from "./internal/useOperationScope.js";
import { setupOperationErrorReporting } from "./operationUiHelpers.js";

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
  mapLoadedToModel,
  realtime = null
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
    },
    realtime
  });
  const canView = operationScope.permissionGate("view");

  const resource = useEndpointResource({
    queryKey: operationScope.queryKey,
    path: operationScope.apiPath,
    enabled: operationScope.queryCanRun(canView),
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
  setupOperationErrorReporting({
    source: `${placementSource}.load`,
    loadError,
    notFoundError: view.notFoundError
  });

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
