<template>
  <section class="workspace-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
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
          You do not have permission to view workspace settings.
        </p>

        <template v-else>
          <v-form @submit.prevent="addEdit.submit" novalidate>
            <v-progress-linear v-if="addEdit.isRefetching" indeterminate class="mb-4" />
            <v-row>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="workspaceForm.name"
                  label="Workspace name"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                  :error-messages="addEdit.fieldErrors.name ? [addEdit.fieldErrors.name] : []"
                />
              </v-col>

              <v-col cols="12" md="6">
                <v-text-field
                  v-model="workspaceForm.avatarUrl"
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

              <v-col cols="12">
                <div class="text-subtitle-2 mb-2">Theme colors</div>
                <v-row dense class="mb-2">
                  <v-col cols="12">
                    <div class="text-caption text-medium-emphasis mb-2">Light palette</div>
                  </v-col>
                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.lightPrimaryColor"
                      label="Primary"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.lightPrimaryColor ? [addEdit.fieldErrors.lightPrimaryColor] : []
                      "
                    />
                  </v-col>

                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.lightSecondaryColor"
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
                      v-model="workspaceForm.lightSurfaceColor"
                      label="Surface"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.lightSurfaceColor ? [addEdit.fieldErrors.lightSurfaceColor] : []
                      "
                    />
                  </v-col>

                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.lightSurfaceVariantColor"
                      label="Surface variant"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.lightSurfaceVariantColor
                          ? [addEdit.fieldErrors.lightSurfaceVariantColor]
                          : []
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
                      v-model="workspaceForm.darkPrimaryColor"
                      label="Primary"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.darkPrimaryColor ? [addEdit.fieldErrors.darkPrimaryColor] : []
                      "
                    />
                  </v-col>

                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.darkSecondaryColor"
                      label="Secondary"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.darkSecondaryColor ? [addEdit.fieldErrors.darkSecondaryColor] : []
                      "
                    />
                  </v-col>

                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.darkSurfaceColor"
                      label="Surface"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.darkSurfaceColor ? [addEdit.fieldErrors.darkSurfaceColor] : []
                      "
                    />
                  </v-col>

                  <v-col cols="12" md="3">
                    <v-text-field
                      v-model="workspaceForm.darkSurfaceVariantColor"
                      label="Surface variant"
                      type="color"
                      variant="outlined"
                      density="comfortable"
                      :readonly="!addEdit.canSave || addEdit.isSaving || addEdit.isRefetching"
                      :error-messages="
                        addEdit.fieldErrors.darkSurfaceVariantColor
                          ? [addEdit.fieldErrors.darkSurfaceVariantColor]
                          : []
                      "
                    />
                  </v-col>
                </v-row>
              </v-col>

              <v-col cols="12" md="6" class="d-flex align-center">
                <v-switch
                  v-model="workspaceForm.invitesEnabled"
                  color="primary"
                  hide-details
                  label="Enable invites"
                  :disabled="!addEdit.canSave || !workspaceForm.invitesAvailable || addEdit.isSaving || addEdit.isRefetching"
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
  </section>
</template>

<script setup>
import { computed, reactive, watch } from "vue";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { workspaceSettingsResource } from "@jskit-ai/users-core/shared/resources/workspaceSettingsResource";
import { WORKSPACE_SETTINGS_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import { USERS_ROUTE_VISIBILITY_WORKSPACE } from "@jskit-ai/users-core/shared/support/usersVisibility";
import {
  DEFAULT_WORKSPACE_DARK_PALETTE,
  DEFAULT_WORKSPACE_LIGHT_PALETTE,
  resolveWorkspaceThemePalettes
} from "@jskit-ai/users-core/shared/settings";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAddEdit } from "../composables/useAddEdit.js";
import { useBootstrapQuery } from "../composables/useBootstrapQuery.js";
import { useWorkspaceRouteContext } from "../composables/useWorkspaceRouteContext.js";
import { findWorkspaceBySlug, normalizeWorkspaceList } from "../lib/bootstrap.js";
import { arePermissionListsEqual, normalizePermissionList } from "../lib/permissions.js";
import { createWorkspaceRealtimeMatcher } from "../support/realtimeWorkspace.js";
import { buildWorkspaceQueryKey } from "../support/workspaceQueryKeys.js";

const workspaceForm = reactive({
  name: "",
  lightPrimaryColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.color,
  lightSecondaryColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.secondaryColor,
  lightSurfaceColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceColor,
  lightSurfaceVariantColor: DEFAULT_WORKSPACE_LIGHT_PALETTE.surfaceVariantColor,
  darkPrimaryColor: DEFAULT_WORKSPACE_DARK_PALETTE.color,
  darkSecondaryColor: DEFAULT_WORKSPACE_DARK_PALETTE.secondaryColor,
  darkSurfaceColor: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceColor,
  darkSurfaceVariantColor: DEFAULT_WORKSPACE_DARK_PALETTE.surfaceVariantColor,
  avatarUrl: "",
  invitesEnabled: false,
  invitesAvailable: false
});
const routeContext = useWorkspaceRouteContext();
const { context: placementContext, mergeContext: mergePlacementContext } = useWebPlacementContext();
const OWNERSHIP_WORKSPACE = USERS_ROUTE_VISIBILITY_WORKSPACE;
const bootstrapQuery = useBootstrapQuery({
  workspaceSlug: routeContext.workspaceSlugFromRoute,
  enabled: computed(() => Boolean(routeContext.workspaceSlugFromRoute.value))
});

function toWorkspaceEntrySnapshot(entry = null) {
  if (!entry || typeof entry !== "object") {
    return "";
  }

  const normalizedEntry = normalizeWorkspaceList([entry])[0] || null;
  if (!normalizedEntry) {
    return "";
  }
  return JSON.stringify(normalizedEntry);
}

function toWorkspaceListSnapshot(list = []) {
  return JSON.stringify(normalizeWorkspaceList(list));
}

function toWorkspaceSettingsSnapshot(settings = null) {
  if (!settings || typeof settings !== "object") {
    return "";
  }

  const normalized = resolveWorkspaceThemePalettes(settings);
  return JSON.stringify({
    lightPrimaryColor: normalized.light.color,
    lightSecondaryColor: normalized.light.secondaryColor,
    lightSurfaceColor: normalized.light.surfaceColor,
    lightSurfaceVariantColor: normalized.light.surfaceVariantColor,
    darkPrimaryColor: normalized.dark.color,
    darkSecondaryColor: normalized.dark.secondaryColor,
    darkSurfaceColor: normalized.dark.surfaceColor,
    darkSurfaceVariantColor: normalized.dark.surfaceVariantColor,
    invitesEnabled: settings.invitesEnabled !== false,
    invitesAvailable: settings.invitesAvailable !== false
  });
}

function applyShellWorkspaceContext(payload = {}) {
  const availableWorkspaces = normalizeWorkspaceList(payload?.workspaces);
  const currentWorkspace = findWorkspaceBySlug(
    availableWorkspaces,
    routeContext.workspaceSlugFromRoute.value
  );
  const permissions = normalizePermissionList(payload?.permissions);
  const currentContext =
    placementContext.value && typeof placementContext.value === "object"
      ? placementContext.value
      : {};
  const currentPermissions = normalizePermissionList(currentContext.permissions);
  const samePermissions = arePermissionListsEqual(permissions, currentPermissions);
  const sameWorkspace = toWorkspaceEntrySnapshot(currentContext.workspace) === toWorkspaceEntrySnapshot(currentWorkspace);
  const sameWorkspaces =
    toWorkspaceListSnapshot(currentContext.workspaces) === toWorkspaceListSnapshot(availableWorkspaces);
  const sameWorkspaceSettings =
    toWorkspaceSettingsSnapshot(currentContext.workspaceSettings) ===
    toWorkspaceSettingsSnapshot(payload?.workspaceSettings);

  if (samePermissions && sameWorkspace && sameWorkspaces && sameWorkspaceSettings) {
    return;
  }

  mergePlacementContext(
    {
      workspace: currentWorkspace,
      workspaceSettings:
        payload?.workspaceSettings && typeof payload.workspaceSettings === "object"
          ? payload.workspaceSettings
          : null,
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

const matchesWorkspaceRealtime = createWorkspaceRealtimeMatcher(routeContext.workspaceSlugFromRoute);

const addEdit = useAddEdit({
  ownershipFilter: OWNERSHIP_WORKSPACE,
  resource: workspaceSettingsResource,
  apiSuffix: "/settings",
  queryKeyFactory: (surfaceId = "", workspaceSlug = "") =>
    buildWorkspaceQueryKey("settings", surfaceId, workspaceSlug),
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  placementSource: "users-web.workspace-settings-view",
  fallbackLoadError: "Unable to load workspace settings.",
  fieldErrorKeys: [
    "name",
    "avatarUrl",
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
    event: WORKSPACE_SETTINGS_CHANGED_EVENT,
    matches: matchesWorkspaceRealtime
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
    const normalizedTheme = resolveWorkspaceThemePalettes(settings);

    model.name = String(settings.name || "");
    model.lightPrimaryColor = normalizedTheme.light.color;
    model.lightSecondaryColor = normalizedTheme.light.secondaryColor;
    model.lightSurfaceColor = normalizedTheme.light.surfaceColor;
    model.lightSurfaceVariantColor = normalizedTheme.light.surfaceVariantColor;
    model.darkPrimaryColor = normalizedTheme.dark.color;
    model.darkSecondaryColor = normalizedTheme.dark.secondaryColor;
    model.darkSurfaceColor = normalizedTheme.dark.surfaceColor;
    model.darkSurfaceVariantColor = normalizedTheme.dark.surfaceVariantColor;
    model.avatarUrl = String(settings.avatarUrl || "");
    model.invitesEnabled = settings.invitesEnabled !== false;
    model.invitesAvailable = settings.invitesAvailable !== false;
  },
  buildRawPayload: (model) => ({
    name: model.name,
    lightPrimaryColor: model.lightPrimaryColor,
    lightSecondaryColor: model.lightSecondaryColor,
    lightSurfaceColor: model.lightSurfaceColor,
    lightSurfaceVariantColor: model.lightSurfaceVariantColor,
    darkPrimaryColor: model.darkPrimaryColor,
    darkSecondaryColor: model.darkSecondaryColor,
    darkSurfaceColor: model.darkSurfaceColor,
    darkSurfaceVariantColor: model.darkSurfaceVariantColor,
    avatarUrl: model.avatarUrl,
    invitesEnabled: model.invitesEnabled
  }),
  onSaveSuccess: async () => {
    await bootstrapQuery.query.refetch();
  }
});

const showFormSkeleton = computed(() => Boolean(addEdit.isInitialLoading));
</script>
