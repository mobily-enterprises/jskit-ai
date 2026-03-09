<template>
  <v-container fluid class="console-home pa-0">
    <v-row class="ma-0" justify="center">
      <v-col cols="12" sm="10" md="9" lg="7">
        <v-sheet class="pa-6 pa-sm-8" rounded="lg" border>
          <h1 class="text-h5 text-sm-h4 mb-3">Console home</h1>
          <p class="text-body-2 text-sm-body-1 mb-3">
            Use this space for console-owned assistant behavior and global operations context.
          </p>

          <v-alert v-if="error" type="error" variant="tonal" class="mb-4">
            {{ error }}
          </v-alert>

          <v-form @submit.prevent="submitSettings" novalidate>
            <v-textarea
              v-model="form.assistantSystemPromptWorkspace"
              label="Assistant system prompt (Workspace/Admin surface)"
              variant="outlined"
              density="comfortable"
              rows="5"
              auto-grow
              :readonly="!canManageSettings"
              :loading="isLoading"
              hint="Applied to admin/workspace assistant conversations across workspaces."
              persistent-hint
            />
            <div class="d-flex justify-end mt-4">
              <v-btn
                type="submit"
                color="primary"
                :loading="isSaving"
                :disabled="!canManageSettings || isLoading"
              >
                Save console assistant settings
              </v-btn>
            </div>
          </v-form>

          <v-alert v-if="message" :type="messageType" variant="tonal" class="mt-4 mb-0">
            {{ message }}
          </v-alert>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import {
  USERS_WEB_QUERY_KEYS,
  useUsersWebAccess,
  useUsersWebEndpointResource,
  useUsersWebUiFeedback,
  usersWebHttpClient
} from "@jskit-ai/users-web/client";

const form = reactive({
  assistantSystemPromptWorkspace: ""
});
const queryKey = USERS_WEB_QUERY_KEYS.consoleSettings();
const access = useUsersWebAccess({
  workspaceSlug: "",
  enabled: true
});
const feedback = useUsersWebUiFeedback();
const message = feedback.message;
const messageType = feedback.messageType;
const canManageSettings = computed(() => true);
const settingsResource = useUsersWebEndpointResource({
  queryKey,
  path: "/api/console/settings",
  enabled: true,
  client: usersWebHttpClient,
  writeMethod: "PATCH",
  fallbackLoadError: "Unable to load console settings.",
  fallbackSaveError: "Unable to update console settings."
});
const error = computed(() => access.bootstrapError.value || settingsResource.loadError.value);
const isLoading = computed(() => Boolean(settingsResource.isLoading.value || access.isBootstrapping.value));
const isSaving = settingsResource.isSaving;

watch(
  () => settingsResource.data.value,
  (payload) => {
    if (!payload) {
      return;
    }
    applySettingsData(payload);
  },
  {
    immediate: true
  }
);

function applySettingsData(data) {
  const settings = data?.settings && typeof data.settings === "object" ? data.settings : {};
  form.assistantSystemPromptWorkspace = String(settings.assistantSystemPromptWorkspace || "");
}

async function submitSettings() {
  if (!canManageSettings.value || isSaving.value) {
    return;
  }

  feedback.clear();
  try {
    const payload = await settingsResource.save({
      assistantSystemPromptWorkspace: form.assistantSystemPromptWorkspace
    });
    applySettingsData(payload);
    feedback.success("Console settings updated.");
  } catch (requestError) {
    feedback.error(requestError, "Unable to update console settings.");
  }
}
</script>

<style scoped>
.console-home {
  min-height: min(100vh, 700px);
  display: grid;
  align-content: start;
  padding-top: clamp(16px, 4vh, 48px);
}
</style>
