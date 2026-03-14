import { computed, watch, proxyRefs, unref } from "vue";
import { useAddEditCore } from "./useAddEditCore.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebAccess } from "./useUsersWebAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";
import { useUsersWebSurfaceRouteContext } from "./useUsersWebSurfaceRouteContext.js";
import { useUsersPaths } from "./useUsersPaths.js";
import {
  normalizePermissions,
  normalizeUsersVisibility,
  isWorkspaceVisibility,
  resolveApiSuffix,
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
  const normalizedVisibility = normalizeUsersVisibility(visibility);
  const workspaceScoped = isWorkspaceVisibility(normalizedVisibility);
  const routeContext = workspaceScoped ? useUsersWebWorkspaceRouteContext() : useUsersWebSurfaceRouteContext();
  const usersPaths = useUsersPaths();

  const workspaceSlugFromRoute = workspaceScoped ? routeContext.workspaceSlugFromRoute : computed(() => "");
  const hasRouteWorkspaceSlug = computed(() => (workspaceScoped ? Boolean(workspaceSlugFromRoute.value) : true));

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
      surfaceId: routeContext.currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      visibility: normalizedVisibility,
      model
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

  const access =
    useUsersWebAccess({
      workspaceSlug: workspaceScoped ? workspaceSlugFromRoute : "",
      enabled: hasRouteWorkspaceSlug,
      mergePlacementContext: routeContext.mergePlacementContext,
      placementSource: String(placementSource || "users-web.add-edit")
    }) || {};

  const canAnyAccess = typeof access.canAny === "function" ? access.canAny.bind(access) : () => false;
  const accessBootstrapError = computed(() => String(unref(access?.bootstrapError) || ""));
  const accessIsBootstrapping = computed(() => Boolean(unref(access?.isBootstrapping)));
  const hasEndpointPath = computed(() => Boolean(unref(apiPath)));

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
    path: apiPath,
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
      () => routeContext.route.fullPath,
      () => {
        feedback.clear();
        fieldBag.clear();
      }
    );
  }

  const loadError = computed(() => {
    if (workspaceScoped && !hasRouteWorkspaceSlug.value) {
      throw new Error("useAddEdit requires route.params.workspaceSlug when visibility is workspace/workspace_user.");
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

export { useAddEdit };
