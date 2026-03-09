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
import { computed, onMounted, reactive, ref } from "vue";
import { createHttpClient } from "@jskit-ai/http-runtime/client";

const client = createHttpClient({
  credentials: "include",
  csrf: {
    sessionPath: "/api/session"
  }
});

const form = reactive({
  assistantSystemPromptWorkspace: ""
});
const error = ref("");
const message = ref("");
const messageType = ref("success");
const loading = ref(false);
const saving = ref(false);

const isLoading = computed(() => loading.value === true);
const isSaving = computed(() => saving.value === true);
const canManageSettings = computed(() => true);

function applySettingsData(data) {
  const settings = data?.settings && typeof data.settings === "object" ? data.settings : {};
  form.assistantSystemPromptWorkspace = String(settings.assistantSystemPromptWorkspace || "");
}

async function loadSettings() {
  loading.value = true;
  error.value = "";

  try {
    const data = await client.request("/api/console/settings", {
      method: "GET"
    });

    applySettingsData(data);
  } catch (requestError) {
    error.value = String(requestError?.message || "Unable to load console settings.");
  } finally {
    loading.value = false;
  }
}

async function submitSettings() {
  if (!canManageSettings.value || saving.value) {
    return;
  }

  message.value = "";
  saving.value = true;

  try {
    const payload = {
      assistantSystemPromptWorkspace: form.assistantSystemPromptWorkspace
    };

    const data = await client.request("/api/console/settings", {
      method: "PATCH",
      body: payload
    });

    applySettingsData(data);
    messageType.value = "success";
    message.value = "Console settings updated.";
  } catch (requestError) {
    messageType.value = "error";
    message.value = String(requestError?.message || "Unable to update console settings.");
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadSettings();
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
