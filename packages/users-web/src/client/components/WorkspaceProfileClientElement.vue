<template>
  <v-card class="mb-4" rounded="lg" elevation="1" border>
    <v-card-item>
      <v-card-title class="text-h6">Workspace profile</v-card-title>
      <v-card-subtitle>Name and avatar used across the workspace.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="pt-4">
      <template v-if="showSkeleton">
        <v-skeleton-loader type="text@2, list-item-two-line@3, button" />
      </template>

      <p v-else-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
        {{ addEdit.loadError }}
      </p>

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
    </v-card-text>
  </v-card>
</template>

<script setup>
import { computed, reactive } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { workspaceResource } from "@jskit-ai/users-core/shared/resources/workspaceResource";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import { useAddEdit } from "../composables/useAddEdit.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const emit = defineEmits(["saved"]);

const workspaceProfileForm = reactive({
  name: "",
  avatarUrl: ""
});

const addEdit = useAddEdit({
  ownershipFilter: USERS_ROUTE_VISIBILITY_WORKSPACE,
  resource: workspaceResource,
  apiSuffix: "/",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("profile", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  placementSource: "users-web.workspace-profile-view",
  fallbackLoadError: "Unable to load workspace profile.",
  fieldErrorKeys: ["name", "avatarUrl"],
  model: workspaceProfileForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: workspaceResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
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
