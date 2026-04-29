<template>
  <v-card rounded="lg" elevation="1" border>
    <v-card-item>
      <v-card-title class="text-h6">Workspace settings</v-card-title>
      <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text class="pt-4">
      <template v-if="showSkeleton">
        <v-skeleton-loader type="text@2, list-item-two-line@4, button" />
      </template>

      <p v-else-if="addEdit.loadError" class="text-body-2 text-medium-emphasis mb-4">
        {{ addEdit.loadError }}
      </p>

      <p v-else-if="!addEdit.canView" class="text-body-2 text-medium-emphasis mb-4">
        You do not have permission to view workspace settings.
      </p>

      <template v-else>
        <v-form @submit.prevent="addEdit.submit" novalidate>
          <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
          <v-row>
            <v-col cols="12">
              <div class="text-subtitle-2 mb-2">Theme colors</div>
              <v-row dense class="mb-2">
                <v-col cols="12">
                  <div class="text-caption text-medium-emphasis mb-2">Light palette</div>
                </v-col>
                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.lightPrimaryColor"
                    label="Primary"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="addEdit.fieldErrors.lightPrimaryColor ? [addEdit.fieldErrors.lightPrimaryColor] : []"
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.lightSecondaryColor"
                    label="Secondary"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="
                      addEdit.fieldErrors.lightSecondaryColor ? [addEdit.fieldErrors.lightSecondaryColor] : []
                    "
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.lightSurfaceColor"
                    label="Surface"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="addEdit.fieldErrors.lightSurfaceColor ? [addEdit.fieldErrors.lightSurfaceColor] : []"
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.lightSurfaceVariantColor"
                    label="Surface variant"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="
                      addEdit.fieldErrors.lightSurfaceVariantColor ? [addEdit.fieldErrors.lightSurfaceVariantColor] : []
                    "
                  />
                </v-col>
              </v-row>

              <v-row dense>
                <v-col cols="12">
                  <div class="text-caption text-medium-emphasis mb-2">Dark palette</div>
                </v-col>
                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.darkPrimaryColor"
                    label="Primary"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="addEdit.fieldErrors.darkPrimaryColor ? [addEdit.fieldErrors.darkPrimaryColor] : []"
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.darkSecondaryColor"
                    label="Secondary"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="addEdit.fieldErrors.darkSecondaryColor ? [addEdit.fieldErrors.darkSecondaryColor] : []"
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.darkSurfaceColor"
                    label="Surface"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="addEdit.fieldErrors.darkSurfaceColor ? [addEdit.fieldErrors.darkSurfaceColor] : []"
                  />
                </v-col>

                <v-col cols="12" md="3">
                  <v-text-field
                    v-model="workspaceSettingsForm.darkSurfaceVariantColor"
                    label="Surface variant"
                    type="color"
                    variant="outlined"
                    density="comfortable"
                    :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                    :error-messages="
                      addEdit.fieldErrors.darkSurfaceVariantColor ? [addEdit.fieldErrors.darkSurfaceVariantColor] : []
                    "
                  />
                </v-col>
              </v-row>
            </v-col>

            <v-col cols="12" md="6" class="d-flex align-center">
              <v-switch
                v-model="workspaceSettingsForm.invitesEnabled"
                color="primary"
                hide-details
                label="Enable invites"
                :disabled="!addEdit.canSave || !workspaceSettingsForm.invitesAvailable || addEdit.isSaving || addEdit.isRefetching"
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
                Save workspace settings
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
import { ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/kernel/shared/support/visibility";
import { workspaceSettingsResource } from "@jskit-ai/workspaces-core/shared/resources/workspaceSettingsResource";
import {
  DEFAULT_WORKSPACE_DARK_PALETTE,
  DEFAULT_WORKSPACE_LIGHT_PALETTE,
  resolveWorkspaceThemePalettes
} from "@jskit-ai/workspaces-core/shared/settings";
import { useAddEdit } from "@jskit-ai/users-web/client/composables/useAddEdit";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { createWorkspaceRealtimeMatcher } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const emit = defineEmits(["saved"]);

const workspaceSettingsForm = reactive({
  lightPrimaryColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.color,
  lightSecondaryColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.secondaryColor,
  lightSurfaceColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceColor,
  lightSurfaceVariantColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceVariantColor,
  darkPrimaryColor: DEFAULT_WORKSPACE_DARK_PALETTE.color,
  darkSecondaryColor: DEFAULT_WORKSPACE_DARK_PALETTE.secondaryColor,
  darkSurfaceColor: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceColor,
  darkSurfaceVariantColor: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceVariantColor,
  invitesEnabled: false,
  invitesAvailable: false
});

const routeContext = useWorkspaceRouteContext();
const matchesWorkspaceRealtime = createWorkspaceRealtimeMatcher(routeContext.workspaceSlugFromRoute);

const addEdit = useAddEdit({
  ownershipFilter: ROUTE_VISIBILITY_WORKSPACE,
  resource: workspaceSettingsResource,
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", scopeParamValue = "") =>
    buildWorkspaceQueryKey("settings", surfaceId, scopeParamValue),
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  placementSource: "workspaces-web.workspace-settings-view",
  fallbackLoadError: "Unable to load workspace settings.",
  fieldErrorKeys: [
    "lightPrimaryColor",
    "lightSecondaryColor",
    "lightSurfaceColor",
    "lightSurfaceVariantColor",
    "darkPrimaryColor",
    "darkSecondaryColor",
    "darkSurfaceColor",
    "darkSurfaceVariantColor"
  ],
  realtime: {
    event: "workspace.settings.changed",
    matches: matchesWorkspaceRealtime
  },
  model: workspaceSettingsForm,
  input: workspaceSettingsResource.operations.patch.body,
  mapLoadedToModel: (model, payload = {}) => {
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    const normalizedTheme = resolveWorkspaceThemePalettes(settings);

    model.lightPrimaryColor = normalizedTheme.light.color;
    model.lightSecondaryColor = normalizedTheme.light.secondaryColor;
    model.lightSurfaceColor = normalizedTheme.light.surfaceColor;
    model.lightSurfaceVariantColor = normalizedTheme.light.surfaceVariantColor;
    model.darkPrimaryColor = normalizedTheme.dark.color;
    model.darkSecondaryColor = normalizedTheme.dark.secondaryColor;
    model.darkSurfaceColor = normalizedTheme.dark.surfaceColor;
    model.darkSurfaceVariantColor = normalizedTheme.dark.surfaceVariantColor;
    model.invitesEnabled = settings.invitesEnabled !== false;
    model.invitesAvailable = settings.invitesAvailable !== false;
  },
  buildRawPayload: (model) => ({
    lightPrimaryColor: model.lightPrimaryColor,
    lightSecondaryColor: model.lightSecondaryColor,
    lightSurfaceColor: model.lightSurfaceColor,
    lightSurfaceVariantColor: model.lightSurfaceVariantColor,
    darkPrimaryColor: model.darkPrimaryColor,
    darkSecondaryColor: model.darkSecondaryColor,
    darkSurfaceColor: model.darkSurfaceColor,
    darkSurfaceVariantColor: model.darkSurfaceVariantColor,
    invitesEnabled: model.invitesEnabled
  }),
  onSaveSuccess: async () => {
    emit("saved");
  }
});

const showSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>
