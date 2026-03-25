<template>
  <AssistantSettingsFormCard
    root-class="assistant-console-settings-client-element"
    title="Assistant console settings"
    subtitle="Configure the prompt used on workspace/admin assistant surfaces."
    no-permission-message="You do not have permission to view assistant console settings."
    save-label="Save assistant console settings"
    :add-edit="addEdit"
    :show-form-skeleton="showFormSkeleton"
  >
    <v-textarea
      v-model="form.workspaceSurfacePrompt"
      label="Workspace/Admin surface prompt"
      variant="outlined"
      density="comfortable"
      rows="6"
      auto-grow
      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
      :error-messages="addEdit.fieldErrors.workspaceSurfacePrompt ? [addEdit.fieldErrors.workspaceSurfacePrompt] : []"
    />
  </AssistantSettingsFormCard>
</template>

<script setup>
import { computed, reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import AssistantSettingsFormCard from "./AssistantSettingsFormCard.vue";
import { assistantConsoleSettingsResource } from "../../shared/assistantSettingsResource.js";

const form = reactive({
  workspaceSurfacePrompt: ""
});

const addEdit = useAddEdit({
  visibility: "public",
  access: "never",
  resource: assistantConsoleSettingsResource,
  apiSuffix: "/console/settings/assistant",
  queryKeyFactory: () => ["assistant", "settings", "console"],
  viewPermissions: [],
  savePermissions: [],
  writeMethod: "PATCH",
  placementSource: "assistant.console-settings-view",
  fallbackLoadError: "Unable to load assistant console settings.",
  fallbackSaveError: "Unable to update assistant console settings.",
  fieldErrorKeys: ["workspaceSurfacePrompt"],
  realtime: {
    event: "assistant.console.settings.changed"
  },
  model: form,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: assistantConsoleSettingsResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel(model, payload = {}) {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    model.workspaceSurfacePrompt = String(settings.workspaceSurfacePrompt || "");
  },
  buildRawPayload(model) {
    return {
      workspaceSurfacePrompt: model.workspaceSurfacePrompt
    };
  }
});

const showFormSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>
