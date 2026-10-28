<template>
  <AssistantSettingsFormCard
    root-class="assistant-settings-client-element"
    :title="t('jskit.assistant.runtime.settings.title')"
    :subtitle="subtitle"
    :no-permission-message="t('jskit.assistant.runtime.settings.noPermission')"
    :save-label="t('jskit.assistant.runtime.settings.save')"
    :add-edit="addEdit"
    :show-form-skeleton="showFormSkeleton"
  >
    <v-textarea
      v-model="form.systemPrompt"
      :label="t('jskit.assistant.runtime.settings.systemPrompt')"
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
import { useSurfaceRouteContext } from "@jskit-ai/shell-web/client/navigation/useSurfaceRouteContext";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";
import { useWorkspaceWebScopeSupport } from "../support/workspaceScopeSupport.js";
import { useJskitText } from "../i18n.js";

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

const { fieldErrorMessages, serverMessage, t } = useJskitText();
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
    return t("jskit.assistant.runtime.settings.subtitle");
  }

  const surface = assistantSurface.value.targetSurfaceId;
  if (assistantSurface.value.configScope === "workspace") {
    return t("jskit.assistant.runtime.settings.subtitleWorkspace", { surface });
  }

  return t("jskit.assistant.runtime.settings.subtitleSurface", { surface });
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
    return t("jskit.assistant.runtime.settings.notConfigured");
  }
  if (hasScope.value) {
    const failure = settingsQuery.error.value;
    return failure?.message ? normalizeText(serverMessage(failure)) : "";
  }

  if (assistantSurface.value?.settingsSurfaceRequiresWorkspace) {
    if (workspaceScopeSupport.available !== true) {
      return t("jskit.assistant.runtime.settings.workspaceUnavailable");
    }

    return t("jskit.assistant.runtime.settings.selectWorkspace");
  }

  return "";
});

async function submit() {
  clearFieldErrors();

  const validation = validateOperationSection({
    operation: assistantConfigResource.operations.patch,
    section: "body",
    value: {
      systemPrompt: form.systemPrompt
    }
  });
  if (!validation.ok) {
    fieldErrors.systemPrompt = String(fieldErrorMessages(validation).systemPrompt || "");
    return;
  }

  try {
    await settingsMutation.mutateAsync(validation.value);
  } catch (error) {
    const nextFieldErrors = fieldErrorMessages({ fieldErrors: normalizeObject(error?.details?.fieldErrors),
      fieldErrorCodes: error?.fieldErrorCodes || error?.details?.fieldErrorCodes });
    fieldErrors.systemPrompt = String(nextFieldErrors.systemPrompt || "");
    reportAssistantSettingsError(
      (error?.message && normalizeText(serverMessage(error))) || t("jskit.assistant.runtime.settings.updateFailed"),
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
