import { computed } from "vue";
import { useUsersWebAddEditScreen } from "./useUsersWebAddEditScreen.js";
import { useUsersWebEndpointResource } from "./useUsersWebEndpointResource.js";
import { useUsersWebWorkspaceAccess } from "./useUsersWebWorkspaceAccess.js";
import { useUsersWebUiFeedback } from "./useUsersWebUiFeedback.js";
import { useUsersWebFieldErrorBag } from "./useUsersWebFieldErrorBag.js";
import { useUsersWebWorkspaceRouteContext } from "./useUsersWebWorkspaceRouteContext.js";

function asPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function normalizePermissions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean);
  }
  const one = String(value || "").trim();
  return one ? [one] : [];
}

function resolveQueryKey(queryKeyFactory, surfaceId, workspaceSlug) {
  if (typeof queryKeyFactory !== "function") {
    throw new TypeError("useAddEditScreen requires queryKeyFactory(surfaceId, workspaceSlug).");
  }

  return queryKeyFactory(surfaceId, workspaceSlug);
}

function resolveSavePayload(buildSavePayload, parsed = {}) {
  if (typeof buildSavePayload === "function") {
    return buildSavePayload(parsed);
  }

  if (Object.hasOwn(parsed, "workspacePatch") || Object.hasOwn(parsed, "settingsPatch")) {
    return {
      ...asPlainObject(parsed.workspacePatch),
      ...asPlainObject(parsed.settingsPatch)
    };
  }

  return parsed;
}

function resolveApiSuffix(apiSuffix, context = {}) {
  if (typeof apiSuffix === "function") {
    return String(apiSuffix(context) || "").trim();
  }

  return String(apiSuffix || "").trim();
}

function resolveReadEnabled(readEnabled, context = {}) {
  if (typeof readEnabled === "function") {
    return Boolean(readEnabled(context));
  }

  return Boolean(readEnabled);
}

function useAddEditScreen({
  apiSuffix = "",
  queryKeyFactory = null,
  viewPermissions = [],
  savePermissions = [],
  readMethod = "GET",
  readEnabled = true,
  writeMethod = "PATCH",
  placementSource = "users-web.add-edit-view",
  missingWorkspaceSlugError = "Workspace slug is required in the URL.",
  fallbackLoadError = "Unable to load resource.",
  fallbackSaveError = "Unable to save resource.",
  model,
  parseInput,
  mapLoadedToModel,
  buildRawPayload,
  buildSavePayload = null,
  onSaveSuccess = null,
  messages = {}
} = {}) {
  const { currentSurfaceId, workspaceSlugFromRoute, resolveWorkspaceApiPath, mergePlacementContext } =
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
    resolveReadEnabled(readEnabled, {
      surfaceId: currentSurfaceId.value,
      workspaceSlug: workspaceSlugFromRoute.value,
      model
    })
  );
  const queryKey = computed(() => resolveQueryKey(queryKeyFactory, currentSurfaceId.value, workspaceSlugFromRoute.value));

  const access = useUsersWebWorkspaceAccess({
    workspaceSlug: workspaceSlugFromRoute,
    enabled: hasRouteWorkspaceSlug,
    mergePlacementContext,
    placementSource: String(placementSource || "users-web.add-edit-view")
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
  const fieldBag = useUsersWebFieldErrorBag();

  const addEdit = useUsersWebAddEditScreen({
    provideSpec: () => ({
      model,
      resource,
      queryKey,
      canSave,
      fieldBag,
      feedback,
      parseInput,
      mapLoadedToModel,
      buildRawPayload,
      buildSavePayload: (parsed) => resolveSavePayload(buildSavePayload, parsed),
      onSaveSuccess,
      messages: {
        validation: "Fix invalid values and try again.",
        saveSuccess: "Saved.",
        saveError: "Unable to save.",
        ...asPlainObject(messages)
      }
    })
  });

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
    submit: addEdit.submit
  });
}

export { useAddEditScreen };
