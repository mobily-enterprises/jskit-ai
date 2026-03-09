import { computed, watch } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebWorkspaceAccess } from "./useUsersWebWorkspaceAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import {
  normalizePermissions,
  resolveApiSuffix,
  resolveEnabled,
  resolveQueryKeyForWorkspace
} from "./scopeHelpers.js";

function useWorkspaceAddEdit({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.workspace.add-edit",
  missingWorkspaceSlugError = "Workspace slug is required in the URL.",
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
  const { route, currentSurfaceId, workspaceSlugFromRoute, resolveWorkspaceApiPath, mergePlacementContext } =
    useUsersWebWorkspaceRouteContext();

  const normalizedViewPermissions = normalizePermissions(viewPermissions);
  const normalizedSavePermissions = normalizePermissions(savePermissions);

  const hasRouteWorkspaceSlug = computed(() => Boolean(workspaceSlugFromRoute.value));

  const workspaceApiPath = computed(() => {
    const suffix = resolveApiSuffix(apiSuffix, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      model
    });

    return resolveWorkspaceApiPath(suffix);
  });

  const queryEnabled = computed(() =>
    resolveEnabled(readEnabled, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      model
    })
  );

  const queryKey = computed(() =>
    resolveQueryKeyForWorkspace(queryKeyFactory, currentSurfaceId.value, workspaceSlugFromRoute.value)
  );

  const access = useUsersWebWorkspaceAccess({
    workspaceSlug: workspaceSlugFromRoute,
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.workspace.add-edit")
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

  const resource = useUsersWebEndpointResource({
    queryKey,
    path: workspaceApiPath,
    enabled: computed(
      () => queryEnabled.value && hasRouteWorkspaceSlug.value && Boolean(workspaceApiPath.value) && canView.value
    ),
    readMethod,
    writeMethod,
    fallbackLoadError,
    fallbackSaveError
  });

  const feedback = useUsersWebUiFeedback();
  const fieldBag = useUsersWebFieldErrorBag(fieldErrorKeys);

  const addEdit = useAddEditCore({
    model,
    resource,
    queryKey,
    canSave,
    fieldBag,
    feedback,
    parseInput,
    mapLoadedToModel,
    buildRawPayload,
    buildSavePayload,
    onSaveSuccess,
    messages: {
      validation: "Fix invalid values and try again.",
      saveSuccess: "Saved.",
      saveError: "Unable to save.",
      ...(messages && typeof messages === "object" ? messages : {})
    }
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
    if (!hasRouteWorkspaceSlug.value) {
      return String(missingWorkspaceSlugError || "Workspace slug is required in the URL.");
    }

    if (access.bootstrapError.value) {
      return access.bootstrapError.value;
    }

    return resource.loadError.value;
  });

  const isLoading = computed(() => Boolean(resource.isLoading.value || access.isBootstrapping.value));

  return Object.freeze({
    canView,
    canSave,
    loadError,
    isLoading,
    isSaving: addEdit.saving,
    fieldErrors: addEdit.fieldErrors,
    message: addEdit.message,
    messageType: addEdit.messageType,
    submit: addEdit.submit,
    refresh: resource.reload,
    resource
  });
}

export { useWorkspaceAddEdit };
