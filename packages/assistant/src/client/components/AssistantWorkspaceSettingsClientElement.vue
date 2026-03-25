<template>
  <AssistantSettingsFormCard
    root-class="assistant-workspace-settings-client-element"
    title="Assistant workspace settings"
    subtitle="Configure the prompt used on the app surface for this workspace."
    no-permission-message="You do not have permission to view assistant workspace settings."
    save-label="Save assistant workspace settings"
    :add-edit="addEdit"
    :show-form-skeleton="showFormSkeleton"
  >
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
  </AssistantSettingsFormCard>
</template>

<script setup>
import { computed, reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { matchesCurrentWorkspaceEvent } from "@jskit-ai/users-web/client/support/realtimeWorkspace";
import AssistantSettingsFormCard from "./AssistantSettingsFormCard.vue";
import { assistantWorkspaceSettingsResource } from "../../shared/assistantSettingsResource.js";

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
    event: "assistant.workspace.settings.changed",
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
