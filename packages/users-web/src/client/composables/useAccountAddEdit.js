import { computed, watch, proxyRefs } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import {
  normalizePermissions,
  normalizeApiPath,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForScope,
  resolveResourceMessages
} from "./scopeHelpers.js";

function useAccountAddEdit({
  resource = null,
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.account.add-edit",
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
  const { route, currentSurfaceId, mergePlacementContext } = useUsersWebSurfaceRouteContext();

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

  const apiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value,
      model
    });

    return normalizeApiPath(suffix);
  });

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: currentSurfaceId.value,
      model
    })
  );

  const queryKey = computed(() => resolveQueryKeyForScope(queryKeyFactory, currentSurfaceId.value));

  const access = useUsersWebAccess({
    workspaceSlug: "",
    enabled: true,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.account.add-edit")
  });

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedViewPermissions);
  });

  const canSave = computed(() => {
    if (normalizedSavePermissions.length < 1) {
      return true;
    }

    return access.canAny(normalizedSavePermissions);
  });

  const endpointResource = useUsersWebEndpointResource({
    queryKey,
    path: apiPath,
    enabled: computed(() => queryEnabled.value && Boolean(apiPath.value) && canView.value),
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

  if (clearOnRouteChange) {
    watch(
      () => route.fullPath,
      () => {
        feedback.clear();
        fieldBag.clear();
      }
    );
  }

  const loadError = computed(() => {
    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return endpointResource.loadError.value;
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

export { useAccountAddEdit };
