<template>
  <section class="workspace-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <p v-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
          {{ addEdit.loadError }}
        </p>

        <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
          You do not have permission to view workspace settings.
        </p>

        <template v-else>
          <v-form @submit.prevent="addEdit.submit" novalidate>
            <v-row>
              <v-col cols="12" md="5">
                <v-text-field
                  v-model="workspaceForm.name"
                  label="Workspace name"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving"
                  :error-messages="addEdit.fieldErrors.name ? [addEdit.fieldErrors.name] : []"
                />
              </v-col>

              <v-col cols="12" md="2">
                <v-text-field
                  v-model="workspaceForm.color"
                  label="Workspace color"
                  type="color"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving"
                  :error-messages="addEdit.fieldErrors.color ? [addEdit.fieldErrors.color] : []"
                />
              </v-col>

              <v-col cols="12" md="5">
                <v-text-field
                  v-model="workspaceForm.avatarUrl"
                  label="Workspace avatar URL"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving"
                  placeholder="https://..."
                  hint="Optional"
                  persistent-hint
                  :error-messages="addEdit.fieldErrors.avatarUrl ? [addEdit.fieldErrors.avatarUrl] : []"
                />
              </v-col>

              <v-col cols="12" md="6" class="d-flex align-center">
                <v-switch
                  v-model="workspaceForm.invitesEnabled"
                  color="primary"
                  hide-details
                  label="Enable invites"
                  :disabled="!addEdit.canSave || !workspaceForm.invitesAvailable || addEdit.isSaving"
                />
              </v-col>

              <v-col cols="12" class="d-flex align-center justify-end ga-3">
                <v-progress-circular v-if="addEdit.isLoading" size="18" indeterminate />
                <v-btn
                  v-if="addEdit.canSave"
                  type="submit"
                  color="primary"
                  :loading="addEdit.isSaving"
                  :disabled="addEdit.isLoading"
                >
                  Save workspace settings
                </v-btn>
                <v-chip v-else color="secondary" label>Read-only</v-chip>
              </v-col>
            </v-row>
          </v-form>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { workspaceSettingsResource } from "@jskit-ai/users-core/shared/resources/workspaceSettingsResource";
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAddEdit } from "../composables/useAddEdit.js";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { findWorkspaceBySlug, normalizeWorkspaceList } from "../lib/bootstrap.js";
import { normalizePermissionList } from "../lib/permissions.js";
import { matchesCurrentWorkspaceEvent } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const DEFAULT_WORKSPACE_COLOR = "#0F6B54";

const workspaceForm = reactive({
  name: "",
  color: DEFAULT_WORKSPACE_COLOR,
  avatarUrl: "",
  invitesEnabled: false,
  invitesAvailable: false
});
const routeContext = useWorkspaceRouteContext();
const { mergeContext: mergePlacementContext } = useWebPlacementContext();
const bootstrapQuery = useBootstrapQuery({
  workspaceSlug: routeContext.workspaceSlugFromRoute,
  enabled: computed(() => Boolean(routeContext.workspaceSlugFromRoute.value))
});

function applyShellWorkspaceContext(payload = {}) {
  const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
  const currentWorkspace = findWorkspaceBySlug(
    availableWorkspaces,
    routeContext.workspaceSlugFromRoute.value
  );
  const permissions = normalizePermissionList(payload?.permissions);

  mergePlacementContext(
    {
      workspace: currentWorkspace,
      workspaces: availableWorkspaces,
      permissions
    },
    "users-web.workspace-settings-view"
  );
}

watch(
  () => bootstrapQuery.query.data.value,
  (payload) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    applyShellWorkspaceContext(payload);
  },
  { immediate: true }
);

function isCurrentWorkspaceRealtimeEvent({ payload = {} } = {}) {
  return matchesCurrentWorkspaceEvent(payload, routeContext.workspaceSlugFromRoute.value);
}

const addEdit = useAddEdit({
  visibility: "workspace",
  resource: workspaceSettingsResource,
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("settings", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  placementSource: "users-web.workspace-settings-view",
  fallbackLoadError: "Unable to load workspace settings.",
  fieldErrorKeys: ["name", "avatarUrl", "color"],
  realtime: {
    event: WORKSPACE_SETTINGS_CHANGED_EVENT,
    matches: isCurrentWorkspaceRealtimeEvent
  },
  model: workspaceForm,
  parseInput: (rawPayload) =>
    validateOperationSection({
      operation: workspaceSettingsResource.operations.patch,
      section: "bodyValidator",
      value: rawPayload
    }),
  mapLoadedToModel: (model, payload = {}) => {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};

    model.name = String(settings.name || "");
    model.color = String(settings.color || DEFAULT_WORKSPACE_COLOR);
    model.avatarUrl = String(settings.avatarUrl || "");
    model.invitesEnabled = settings.invitesEnabled !== false;
    model.invitesAvailable = settings.invitesAvailable !== false;
  },
  buildRawPayload: (model) => ({
    name: model.name,
    color: model.color,
    avatarUrl: model.avatarUrl,
    invitesEnabled: model.invitesEnabled
  }),
  onSaveSuccess: async () => {
    await bootstrapQuery.query.refetch();
  }
});
</script>
