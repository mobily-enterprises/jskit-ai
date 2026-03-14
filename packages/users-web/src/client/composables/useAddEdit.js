import { computed, proxyRefs } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebScopeRuntime } from "./useUsersWebScopeRuntime.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { setupRouteChangeCleanup } from "./operationUiHelpers.js";
import {
  normalizePermissions,
  resolvePermissionAccess,
  resolveEnabled,
  resolveQueryKey,
  resolveResourceMessages
} from "./scopeHelpers.js";

function useAddEdit({
  visibility = "workspace",
  resource = null,
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.add-edit",
  fallbackLoadError = "Unable to load resource.",
  fallbackSaveError = "Unable to save resource.",
  fieldErrorKeys = [],
  clearOnRouteChange = true,
  model,
  parseInput,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload,
  onSaveSuccess,
  messages = {}
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
  const normalizedSavePermissions = normalizePermissions(savePermissions);
  const resolvedMessages = resolveResourceMessages(resource, {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Saved.",
    saveError: "Unable to save."
  });
  const customMessages = messages && typeof messages === "object" ? messages : {};
  const effectiveMessages = {
    ...resolvedMessages,
    ...customMessages
  };

  const apiPath = computed(() =>
    scopeRuntime.resolveApiPath(apiSuffix, {
      model
    })
  );

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility,
      model
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

  const canSave = computed(() => {
    return resolvePermissionAccess(access, normalizedSavePermissions);
  });

  const endpointResource = useUsersWebEndpointResource({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(apiPath.value) && canView.value),
    readMethod,
    writeMethod,
    fallbackLoadError,
    fallbackSaveError: String(fallbackSaveError || effectiveMessages.saveError || "Unable to save resource.")
  });

  const feedback = useUsersWebUiFeedback();
  const fieldBag = useUsersWebFieldErrorBag(fieldErrorKeys);

  const addEdit = useAddEditCore({
    model,
    resource: endpointResource,
    queryKey,
    canSave,
    fieldBag,
    feedback,
    parseInput,
    mapLoadedToModel,
    buildRawPayload,
    buildSavePayload,
    onSaveSuccess,
    messages: effectiveMessages
  });

  setupRouteChangeCleanup({
    enabled: clearOnRouteChange,
    route: routeContext.route,
    feedback,
    fieldBag
  });

  const loadError = computed(() => {
    scopeRuntime.requireWorkspaceRouteParam("useAddEdit");

    const bootstrapError = String(access.bootstrapError.value || "");
    if (bootstrapError) {
      return bootstrapError;
    }

    return String(endpointResource.loadError.value || "");
  });

  const isLoading = computed(() => Boolean(endpointResource.isLoading.value || access.isBootstrapping.value));

  return proxyRefs({
    canView,
    canSave,
    loadError,
    isLoading,
    isSaving: addEdit.saving,
    fieldErrors: addEdit.fieldErrors,
    message: addEdit.message,
    messageType: addEdit.messageType,
    submit: addEdit.submit,
    refresh: endpointResource.reload,
    resource: endpointResource
  });
}

export { useAddEdit };
