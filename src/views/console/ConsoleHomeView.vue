<template>
  <v-container fluid class="console-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="9" lg="7">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">Console home</h1>
          <p class="text-body-2 text-sm-body-1 mb-3">
            Use this space for console-owned assistant behavior and global operations context.
          </p>

          <v-alert v-if="feedback.error" type="error" variant="tonal" class="mb-4">
            {{ feedback.error }}
          </v-alert>

          <v-form @submit.prevent="actions.submitSettings" novalidate>
            <v-textarea
              v-model="form.assistantSystemPromptWorkspace"
              label="Assistant system prompt (Workspace/Admin surface)"
              variant="outlined"
              density="comfortable"
              rows="5"
              auto-grow
              :readonly="!permissions.canManageSettings"
              :loading="status.isLoading"
              hint="Applied to admin/workspace assistant conversations across workspaces."
              persistent-hint
            />
            <div class="d-flex justify-end mt-4">
              <v-btn
                type="submit"
                color="primary"
                :loading="status.isSaving"
                :disabled="!permissions.canManageSettings || status.isLoading"
              >
                Save console assistant settings
              </v-btn>
            </div>
          </v-form>

          <v-alert v-if="feedback.message" :type="feedback.messageType" variant="tonal" class="mt-4 mb-0">
            {{ feedback.message }}
          </v-alert>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
import { useConsoleHomeView } from "./useConsoleHomeView.js";

export default {
  name: "ConsoleHomeView",
  setup() {
    return useConsoleHomeView();
  }
};
</script>

<style scoped>
.console-home {
  min-height: min(100vh, 700px);
  display: grid;
  align-content: start;
  padding-top: clamp(16px, 4vh, 48px);
}
</style>
