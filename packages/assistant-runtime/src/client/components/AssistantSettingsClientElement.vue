<template>
  <AssistantSettingsFormCard
    root-class="assistant-settings-client-element"
    title="Assistant settings"
    :subtitle="subtitle"
    no-permission-message="You do not have permission to view assistant settings."
    save-label="Save assistant settings"
    :add-edit="addEdit"
    :show-form-skeleton="showFormSkeleton"
  >
    <v-textarea
      v-model="form.systemPrompt"
      label="System prompt"
      variant="outlined"
      density="comfortable"
      rows="8"
      auto-grow
      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
      :error-messages="fieldErrors.systemPrompt ? [fieldErrors.systemPrompt] : []"
    />
  </AssistantSettingsFormCard>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeObject, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { assistantHttpClient, createAssistantApi, AssistantSettingsFormCard } from "@jskit-ai/assistant-core/client";
import { assistantConfigResource, assistantSettingsQueryKey, buildAssistantApiPath } from "@jskit-ai/assistant-core/shared";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useSurfaceRouteContext } from "@jskit-ai/users-web/client/composables/useSurfaceRouteContext";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { useWorkspaceWebScopeSupport } from "../support/workspaceScopeSupport.js";

const props = defineProps({
  targetSurfaceId: {
    type: String,
    required: true
  }
});

const form = reactive({
  systemPrompt: ""
});

const fieldErrors = reactive({
  systemPrompt: ""
});

const errorRuntime = useShellWebErrorRuntime();
const queryClient = useQueryClient();
const appConfig = getClientAppConfig();
const routeContext = useSurfaceRouteContext();
const workspaceScopeSupport = useWorkspaceWebScopeSupport();
const { placementContext, currentSurfaceId } = routeContext;

const assistantSurface = computed(() => resolveAssistantSurfaceConfig(appConfig, props.targetSurfaceId));
const placementSnapshot = computed(() => normalizeObject(placementContext.value));
const routeScope = computed(() => workspaceScopeSupport.readRouteScope(routeContext));
const scope = computed(() => {
  const settingsRequiresWorkspace = assistantSurface.value?.settingsSurfaceRequiresWorkspace === true;
  const workspaceSlug = settingsRequiresWorkspace
    ? normalizeText(routeScope.value.workspaceSlug).toLowerCase()
    : "";

  return {
    targetSurfaceId: normalizeText(assistantSurface.value?.targetSurfaceId).toLowerCase(),
    workspaceSlug,
    workspaceId: settingsRequiresWorkspace
      ? normalizeRecordId(placementSnapshot.value?.workspace?.id, { fallback: null })
      : null
  };
});
const hasScope = computed(() =>
  Boolean(assistantSurface.value) &&
  (assistantSurface.value?.settingsSurfaceRequiresWorkspace ? Boolean(scope.value.workspaceSlug) : true)
);
const queryKey = computed(() => assistantSettingsQueryKey(scope.value));

const settingsApi = createAssistantApi({
  request: assistantHttpClient.request,
  requestStream: assistantHttpClient.requestStream,
  resolveBasePath: () =>
    buildAssistantApiPath({
      requiresWorkspace: assistantSurface.value?.settingsSurfaceRequiresWorkspace === true,
      workspaceSlug: scope.value.workspaceSlug,
      suffix: `/${scope.value.targetSurfaceId}`
    }),
  resolveSurfaceId: () => normalizeText(currentSurfaceId.value).toLowerCase()
});

const subtitle = computed(() => {
  if (!assistantSurface.value) {
    return "Configure assistant settings.";
  }

  if (assistantSurface.value.configScope === "workspace") {
    return `Configure the prompt used on the ${assistantSurface.value.targetSurfaceId} surface for this workspace.`;
  }

  return `Configure the prompt used on the ${assistantSurface.value.targetSurfaceId} surface.`;
});

function clearFieldErrors() {
  fieldErrors.systemPrompt = "";
}

function reportAssistantSettingsError(message, dedupeKey) {
  const normalizedMessage = normalizeText(message);
  if (!normalizedMessage) {
    return;
  }

  errorRuntime.report({
    source: "assistant.settings",
    message: normalizedMessage,
    severity: "error",
    channel: "banner",
    dedupeKey,
    dedupeWindowMs: 3000
  });
}

const settingsQuery = useQuery({
  queryKey,
  enabled: hasScope,
  retry: false,
  queryFn: () => settingsApi.getSettings()
});

watch(
  () => settingsQuery.data.value,
  (payload) => {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    form.systemPrompt = String(settings.systemPrompt || "");
    clearFieldErrors();
  },
  {
    immediate: true
  }
);

const settingsMutation = useMutation({
  mutationFn: (patch) => settingsApi.updateSettings(patch),
  onSuccess(payload) {
    queryClient.setQueryData(queryKey.value, payload);
  }
});

const loadError = computed(() => {
  if (!assistantSurface.value) {
    return "Assistant settings are not configured for this surface.";
  }
  if (hasScope.value) {
    return normalizeText(settingsQuery.error.value?.message);
  }

  if (assistantSurface.value?.settingsSurfaceRequiresWorkspace) {
    if (workspaceScopeSupport.available !== true) {
      return "Workspace support is not available for this assistant surface.";
    }

    return "Select a workspace to configure assistant settings.";
  }

  return "";
});

async function submit() {
  clearFieldErrors();

  const validation = validateOperationSection({
    operation: assistantConfigResource.operations.patch,
    section: "bodyValidator",
    value: {
      systemPrompt: form.systemPrompt
    }
  });
  if (!validation.ok) {
    fieldErrors.systemPrompt = String(validation.fieldErrors.systemPrompt || "");
    if (validation.globalErrors.length > 0) {
      reportAssistantSettingsError(validation.globalErrors[0], "assistant.settings:validation");
    }
    return;
  }

  try {
    await settingsMutation.mutateAsync(validation.value);
  } catch (error) {
    const nextFieldErrors = normalizeObject(error?.details?.fieldErrors);
    fieldErrors.systemPrompt = String(nextFieldErrors.systemPrompt || "");
    reportAssistantSettingsError(
      normalizeText(error?.message) || "Unable to update assistant settings.",
      "assistant.settings:save"
    );
  }
}

const addEdit = computed(() => ({
  canView: Boolean(assistantSurface.value) && hasScope.value,
  canSave: Boolean(assistantSurface.value) && hasScope.value,
  loadError: loadError.value,
  isInitialLoading: Boolean(settingsQuery.isLoading.value),
  isRefetching: Boolean(settingsQuery.isFetching.value && !settingsQuery.isLoading.value),
  isSaving: Boolean(settingsMutation.isPending.value),
  submit
}));

const showFormSkeleton = computed(() => Boolean(settingsQuery.isLoading.value));
</script>
