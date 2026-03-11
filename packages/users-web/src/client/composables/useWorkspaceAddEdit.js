import { computed, watch, proxyRefs, unref } from "vue";
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
  resolveQueryKeyForWorkspace,
  resolveResourceMessages
} from "./scopeHelpers.js";

function useWorkspaceAddEdit({
  resource = null,
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.workspace.add-edit",
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

  const access =
    useUsersWebWorkspaceAccess({
      workspaceSlug: workspaceSlugFromRoute,
      enabled: hasRouteWorkspaceSlug,
      mergePlacementContext,
      placementSource: String(placementSource || "users-web.workspace.add-edit")
    }) || {};

  const canAnyAccess = typeof access.canAny === "function" ? access.canAny.bind(access) : () => false;
  const accessBootstrapError = computed(() => String(unref(access?.bootstrapError) || ""));
  const accessIsBootstrapping = computed(() => Boolean(unref(access?.isBootstrapping)));
  const hasEndpointPath = computed(() => Boolean(unref(workspaceApiPath)));

  const canView = computed(() => {
    if (normalizedViewPermissions.length < 1) {
      return true;
    }

    return canAnyAccess(normalizedViewPermissions);
  });

  const canSave = computed(() => {
    if (normalizedSavePermissions.length < 1) {
      return true;
    }

    return canAnyAccess(normalizedSavePermissions);
  });

  const endpointResource = useUsersWebEndpointResource({
    queryKey,
    path: workspaceApiPath,
    enabled: computed(() => queryEnabled.value && hasRouteWorkspaceSlug.value && hasEndpointPath.value && canView.value),
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
    if (!hasRouteWorkspaceSlug.value) {
      throw new Error("useWorkspaceAddEdit requires route.params.workspaceSlug.");
    }

    const bootstrapError = String(unref(accessBootstrapError) || "");
    if (bootstrapError) {
      return bootstrapError;
    }

    return String(unref(endpointResource?.loadError) || "");
  });

  const isLoading = computed(() => Boolean(unref(endpointResource?.isLoading) || unref(accessIsBootstrapping)));

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

export { useWorkspaceAddEdit };
