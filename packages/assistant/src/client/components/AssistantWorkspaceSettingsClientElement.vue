<template>
  <section class="assistant-workspace-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Assistant workspace settings</v-card-title>
        <v-card-subtitle>Configure the prompt used on the app surface for this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <template v-if="showFormSkeleton">
          <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
        </template>

        <p v-else-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
          {{ addEdit.loadError }}
        </p>

        <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
          You do not have permission to view assistant workspace settings.
        </p>

        <template v-else>
          <v-form @submit.prevent="addEdit.submit" novalidate>
            <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
            <v-textarea
              v-model="form.appSurfacePrompt"
              label="App surface prompt"
              variant="outlined"
              density="comfortable"
              rows="6"
              auto-grow
              :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
              :error-messages="addEdit.fieldErrors.appSurfacePrompt ? [addEdit.fieldErrors.appSurfacePrompt] : []"
            />

            <div class="d-flex align-center justify-end ga-3 mt-2">
              <v-btn
                v-if="addEdit.canSave"
                type="submit"
                color="primary"
                :loading="addEdit.isSaving"
                :disabled="addEdit.isInitialLoading || addEdit.isRefetching"
              >
                Save assistant workspace settings
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
import { computed, reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { matchesCurrentWorkspaceEvent } from "@jskit-ai/users-web/client/support/realtimeWorkspace";
import { assistantWorkspaceSettingsResource } from "../../shared/assistantSettingsResource.js";
import { ASSISTANT_WORKSPACE_SETTINGS_CHANGED_EVENT } from "../../shared/settingsEvents.js";

const form = reactive({
  appSurfacePrompt: ""
});

const addEdit = useAddEdit({
  visibility: "workspace",
  resource: assistantWorkspaceSettingsResource,
  apiSuffix: "/settings/assistant",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") => ["assistant", "settings", "workspace", surfaceId, workspaceSlug],
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  writeMethod: "PATCH",
  placementSource: "assistant.workspace-settings-view",
  fallbackLoadError: "Unable to load assistant workspace settings.",
  fallbackSaveError: "Unable to update assistant workspace settings.",
  fieldErrorKeys: ["appSurfacePrompt"],
  realtime: {
    event: ASSISTANT_WORKSPACE_SETTINGS_CHANGED_EVENT,
    matches: ({ payload = {}, routeContext = {} } = {}) =>
      matchesCurrentWorkspaceEvent(payload, routeContext?.workspaceSlugFromRoute?.value)
  },
  model: form,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: assistantWorkspaceSettingsResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel(model, payload = {}) {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    model.appSurfacePrompt = String(settings.appSurfacePrompt || "");
  },
  buildRawPayload(model) {
    return {
      appSurfacePrompt: model.appSurfacePrompt
    };
  }
});

const showFormSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>
