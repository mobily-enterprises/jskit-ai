<template>
  <v-container fluid class="console-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="9" lg="7">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">Console home</h1>
          <p class="text-body-2 text-sm-body-1 mb-3">
            Use this space for console-owned assistant behavior and global operations context.
          </p>

          <v-alert v-if="addEdit.loadError" type="error" variant="tonal" class="mb-4">
            {{ addEdit.loadError }}
          </v-alert>
          <v-alert v-else-if="!addEdit.canView" type="warning" variant="tonal" class="mb-4">
            You do not have permission to view console settings.
          </v-alert>

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

          <v-alert v-if="addEdit.message" :type="addEdit.messageType" variant="tonal" class="mt-4 mb-0">
            {{ addEdit.message }}
          </v-alert>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { reactive } from "vue";
import {
  USERS_WEB_QUERY_KEYS,
  useGlobalAddEdit
} from "@jskit-ai/users-web/client";

const form = reactive({
  assistantSystemPromptWorkspace: ""
});

const CONSOLE_SETTINGS_MESSAGES = Object.freeze({
  saveSuccess: "Console settings updated.",
  saveError: "Unable to update console settings."
});

const addEdit = useGlobalAddEdit({
  apiSuffix: "/console/settings",
  queryKeyFactory: USERS_WEB_QUERY_KEYS.consoleSettings,
  viewPermissions: ["console.settings.read", "console.settings.update"],
  savePermissions: ["console.settings.update"],
  writeMethod: "PATCH",
  placementSource: "users-web.console-settings-view",
  fallbackLoadError: "Unable to load console settings.",
  fallbackSaveError: "Unable to update console settings.",
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
