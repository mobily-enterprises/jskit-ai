import { computed, proxyRefs } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useEndpointResource } from "./useEndpointResource.js";
import { useScopeRuntime } from "./useScopeRuntime.js";
import { useUiFeedback } from "./useUiFeedback.js";
import { useFieldErrorBag } from "./useFieldErrorBag.js";
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
  access = "auto",
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
  const normalizedViewPermissions = normalizePermissions(viewPermissions);
  const normalizedSavePermissions = normalizePermissions(savePermissions);
  const scopeRuntime = useScopeRuntime({
    visibility,
    access,
    hasPermissionRequirements: normalizedViewPermissions.length > 0 || normalizedSavePermissions.length > 0,
    placementSource
  });
  const normalizedVisibility = scopeRuntime.normalizedVisibility;
  const routeContext = scopeRuntime.routeContext;
  const workspaceSlugFromRoute = scopeRuntime.workspaceSlugFromRoute;
  const hasRouteWorkspaceSlug = scopeRuntime.hasRouteWorkspaceSlug;
  const scopeAccess = scopeRuntime.access;
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
    return resolvePermissionAccess(scopeAccess, normalizedViewPermissions);
  });

  const canSave = computed(() => {
    return resolvePermissionAccess(scopeAccess, normalizedSavePermissions);
  });

  const endpointResource = useEndpointResource({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(apiPath.value) && canView.value),
    readMethod,
    writeMethod,
    fallbackLoadError,
    fallbackSaveError: String(fallbackSaveError || effectiveMessages.saveError || "Unable to save resource.")
  });

  const feedback = useUiFeedback();
  const fieldBag = useFieldErrorBag(fieldErrorKeys);

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
    if (scopeRuntime.workspaceRouteError.value) {
      return scopeRuntime.workspaceRouteError.value;
    }

    const bootstrapError = String(scopeAccess.bootstrapError.value || "");
    if (bootstrapError) {
      return bootstrapError;
    }

    return String(endpointResource.loadError.value || "");
  });

  const isLoading = computed(() => Boolean(endpointResource.isLoading.value || scopeAccess.isBootstrapping.value));

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
