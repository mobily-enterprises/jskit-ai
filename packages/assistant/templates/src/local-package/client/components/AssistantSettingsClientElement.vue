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
      :error-messages="addEdit.fieldErrors.systemPrompt ? [addEdit.fieldErrors.systemPrompt] : []"
    />
  </AssistantSettingsFormCard>
</template>

<script setup>
import { computed, reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { AssistantSettingsFormCard } from "@jskit-ai/assistant-core/client";
import {
  assistantConfigResource,
  assistantSettingsQueryKey
} from "@jskit-ai/assistant-core/shared";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

const form = reactive({
  systemPrompt: ""
});

const subtitle = computed(() => {
  if (assistantRuntimeConfig.configScope === "workspace") {
    return `Configure the prompt used on the ${assistantRuntimeConfig.runtimeSurfaceId} surface for this workspace.`;
  }

  return `Configure the prompt used on the ${assistantRuntimeConfig.runtimeSurfaceId} surface.`;
});

const addEdit = useAddEdit({
  ownershipFilter: assistantRuntimeConfig.settingsSurfaceRequiresWorkspace ? "workspace" : "public",
  surfaceId: assistantRuntimeConfig.settingsSurfaceId,
  access: "auto",
  resource: assistantConfigResource,
  apiSuffix: "/assistant/settings",
  queryKeyFactory: (_surfaceId = "", workspaceSlug = "") =>
    assistantSettingsQueryKey({
      targetSurfaceId: assistantRuntimeConfig.runtimeSurfaceId,
      workspaceSlug
    }),
  viewPermissions: assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
    ? ["workspace.settings.view", "workspace.settings.update"]
    : [],
  savePermissions: assistantRuntimeConfig.settingsSurfaceRequiresWorkspace
    ? ["workspace.settings.update"]
    : [],
  writeMethod: "PATCH",
  placementSource: "assistant.settings-view",
  fallbackLoadError: "Unable to load assistant settings.",
  fallbackSaveError: "Unable to update assistant settings.",
  fieldErrorKeys: ["systemPrompt"],
  model: form,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: assistantConfigResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel(model, payload = {}) {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    model.systemPrompt = String(settings.systemPrompt || "");
  },
  buildRawPayload(model) {
    return {
      systemPrompt: model.systemPrompt
    };
  }
});

const showFormSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>
