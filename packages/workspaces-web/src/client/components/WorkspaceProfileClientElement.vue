<template>
  <v-sheet rounded="lg" border class="workspace-profile-panel">
    <header class="workspace-profile-panel__header">
      <h2 class="workspace-profile-panel__title">Workspace profile</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">Name and avatar used across the workspace.</p>
    </header>

    <div class="workspace-profile-panel__body">
      <template v-if="showSkeleton">
        <v-skeleton-loader type="text@2, list-item-two-line@3, button" />
      </template>

      <div v-else-if="addEdit.loadError" class="workspace-profile-panel__state">
        <p class="text-body-2 text-medium-emphasis mb-4">{{ addEdit.loadError }}</p>
        <v-btn
          v-if="addEdit.canRetryLoad"
          color="primary"
          variant="tonal"
          :loading="addEdit.isFetching"
          @click="addEdit.refresh"
        >
          Retry
        </v-btn>
      </div>

      <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
        You do not have permission to view workspace profile.
      </p>

      <template v-else>
        <v-form @submit.prevent="addEdit.submit" novalidate>
          <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
          <v-row>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="workspaceProfileForm.name"
                label="Workspace name"
                variant="outlined"
                density="comfortable"
                :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                :error-messages="addEdit.fieldErrors.name ? [addEdit.fieldErrors.name] : []"
              />
            </v-col>

            <v-col cols="12" md="6">
              <v-text-field
                v-model="workspaceProfileForm.avatarUrl"
                label="Workspace avatar URL"
                variant="outlined"
                density="comfortable"
                :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                placeholder="https://..."
                hint="Optional"
                persistent-hint
                :error-messages="addEdit.fieldErrors.avatarUrl ? [addEdit.fieldErrors.avatarUrl] : []"
              />
            </v-col>

            <v-col cols="12" class="d-flex align-center justify-end ga-3">
              <v-btn
                v-if="addEdit.canSave"
                type="submit"
                color="primary"
                :loading="addEdit.isSaving"
                :disabled="addEdit.isInitialLoading || addEdit.isRefetching"
              >
                Save workspace profile
              </v-btn>
              <v-chip v-else color="secondary" label>Read-only</v-chip>
            </v-col>
          </v-row>
        </v-form>
      </template>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, reactive } from "vue";
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { WORKSPACES_TRANSPORT } from "@jskit-ai/workspaces-core/shared/jsonApiTransports";
import { workspaceResource } from "@jskit-ai/workspaces-core/shared/resources/workspaceResource";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const emit = defineEmits(["saved"]);

const workspaceProfileForm = reactive({
  name: "",
  avatarUrl: ""
});

const addEdit = useAddEdit({
  ownershipFilter: ROUTE_VISIBILITY_WORKSPACE,
  resource: workspaceResource,
  apiSuffix: "/",
  queryKeyFactory: (surfaceId = "", scopeParamValue = "") =>
    buildWorkspaceQueryKey("profile", surfaceId, scopeParamValue),
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  transport: WORKSPACES_TRANSPORT,
  placementSource: "workspaces-web.workspace-profile-view",
  fallbackLoadError: "Unable to load workspace profile.",
  fieldErrorKeys: ["name", "avatarUrl"],
  model: workspaceProfileForm,
  input: workspaceResource.operations.patch.body,
  mapLoadedToModel: (model, payload = {}) => {
    model.name = String(payload?.name || "");
    model.avatarUrl = String(payload?.avatarUrl || "");
  },
  buildRawPayload: (model) => ({
    name: model.name,
    avatarUrl: model.avatarUrl
  }),
  onSaveSuccess: async () => {
    emit("saved");
  }
});

const showSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>

<style scoped>
.workspace-profile-panel {
  overflow: hidden;
}

.workspace-profile-panel__header {
  padding: 1rem 1rem 0;
}

.workspace-profile-panel__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.2;
  margin: 0 0 0.25rem;
}

.workspace-profile-panel__body {
  padding: 1rem;
}

.workspace-profile-panel__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: 1.5rem 1rem;
  text-align: center;
}

@media (max-width: 640px) {
  .workspace-profile-panel__body :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
