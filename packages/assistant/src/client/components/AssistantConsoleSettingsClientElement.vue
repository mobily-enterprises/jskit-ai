<template>
  <section class="assistant-console-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Assistant console settings</v-card-title>
        <v-card-subtitle>Configure the prompt used on workspace/admin assistant surfaces.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <p v-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
          {{ addEdit.loadError }}
        </p>

        <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
          You do not have permission to view assistant console settings.
        </p>

        <template v-else>
          <v-form @submit.prevent="addEdit.submit" novalidate>
            <v-textarea
              v-model="form.workspaceSurfacePrompt"
              label="Workspace/Admin surface prompt"
              variant="outlined"
              density="comfortable"
              rows="6"
              auto-grow
              :readonly="!addEdit.canSave || addEdit.isSaving"
              :error-messages="
                addEdit.fieldErrors.workspaceSurfacePrompt ? [addEdit.fieldErrors.workspaceSurfacePrompt] : []
              "
            />

            <div class="d-flex align-center justify-end ga-3 mt-2">
              <v-progress-circular v-if="addEdit.isLoading" size="18" indeterminate />
              <v-btn
                v-if="addEdit.canSave"
                type="submit"
                color="primary"
                :loading="addEdit.isSaving"
                :disabled="addEdit.isLoading"
              >
                Save assistant console settings
              </v-btn>
              <v-chip v-else color="secondary" label>Read-only</v-chip>
            </div>
          </v-form>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { assistantConsoleSettingsResource } from "../../shared/assistantSettingsResource.js";
import { ASSISTANT_CONSOLE_SETTINGS_CHANGED_EVENT } from "../../shared/settingsEvents.js";

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
    event: ASSISTANT_CONSOLE_SETTINGS_CHANGED_EVENT
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
</script>
