<template>
  <v-container fluid class="console-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="9" lg="7">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">Console home</h1>
          <p class="text-body-2 text-sm-body-1 mb-3">
            Use this space for console-owned assistant behavior and global operations context.
          </p>

          <p v-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
            {{ addEdit.loadError }}
          </p>
          <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
            You do not have permission to view console settings.
          </p>

          <v-form @submit.prevent="addEdit.submit" novalidate>
            <v-textarea
              v-model="form.assistantSystemPromptWorkspace"
              label="Assistant system prompt (Workspace/Admin surface)"
              variant="outlined"
              density="comfortable"
              rows="5"
              auto-grow
              :readonly="!addEdit.canSave"
              :loading="addEdit.isLoading"
              hint="Applied to admin/workspace assistant conversations across workspaces."
              persistent-hint
            />
            <div class="d-flex justify-end mt-4">
              <v-btn
                type="submit"
                color="primary"
                :loading="addEdit.isSaving"
                :disabled="!addEdit.canSave || addEdit.isLoading"
              >
                Save console assistant settings
              </v-btn>
            </div>
          </v-form>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { reactive } from "vue";
import { useAddEdit } from "../composables/useAddEdit.js";
import { CONSOLE_SETTINGS_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";

const form = reactive({
  assistantSystemPromptWorkspace: ""
});

const CONSOLE_SETTINGS_MESSAGES = Object.freeze({
  saveSuccess: "Console settings updated.",
  saveError: "Unable to update console settings."
});

const addEdit = useAddEdit({
  visibility: "public",
  apiSuffix: "/console/settings",
  queryKeyFactory: () => ["users-web", "settings", "console"],
  viewPermissions: ["console.settings.read", "console.settings.update"],
  savePermissions: ["console.settings.update"],
  writeMethod: "PATCH",
  placementSource: "users-web.console-settings-view",
  fallbackLoadError: "Unable to load console settings.",
  fallbackSaveError: "Unable to update console settings.",
  realtime: {
    event: CONSOLE_SETTINGS_CHANGED_EVENT
  },
  model: form,
  mapLoadedToModel: (model, payload = {}) => {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    model.assistantSystemPromptWorkspace = String(settings.assistantSystemPromptWorkspace || "");
  },
  buildRawPayload: (model) => ({
    assistantSystemPromptWorkspace: model.assistantSystemPromptWorkspace
  }),
  messages: CONSOLE_SETTINGS_MESSAGES
});
</script>

<style scoped>
.console-home {
  min-height: min(100vh, 700px);
  display: grid;
  align-content: start;
  padding-top: clamp(16px, 4vh, 48px);
}
</style>
