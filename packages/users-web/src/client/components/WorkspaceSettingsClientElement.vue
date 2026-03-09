<template>
  <section class="workspace-settings-client-element">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="addEdit.loadError" type="error" variant="tonal" class="mb-4">
          {{ addEdit.loadError }}
        </v-alert>

        <v-alert v-else-if="!addEdit.canView" type="warning" variant="tonal" class="mb-4">
          You do not have permission to view workspace settings.
        </v-alert>

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

              <v-col cols="12">
                <v-textarea
                  v-model="workspaceForm.appDenyEmailsText"
                  label="App surface deny list (emails)"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving"
                  hint="Optional. One email per line. Denied users cannot access this workspace on the app surface."
                  persistent-hint
                  rows="4"
                  auto-grow
                  :error-messages="addEdit.fieldErrors.appDenyEmails ? [addEdit.fieldErrors.appDenyEmails] : []"
                />
              </v-col>

              <v-col cols="12">
                <v-textarea
                  v-model="workspaceForm.appDenyUserIdsText"
                  label="App surface deny list (user IDs)"
                  variant="outlined"
                  density="comfortable"
                  :readonly="!addEdit.canSave || addEdit.isSaving"
                  hint="Optional. One user ID per line. Denied users cannot access this workspace on the app surface."
                  persistent-hint
                  rows="3"
                  auto-grow
                  :error-messages="addEdit.fieldErrors.appDenyUserIds ? [addEdit.fieldErrors.appDenyUserIds] : []"
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

          <v-alert v-if="addEdit.message" :type="addEdit.messageType" variant="tonal" class="mt-4 mb-0">
            {{ addEdit.message }}
          </v-alert>
        </template>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { reactive } from "vue";
import { parseWorkspaceSettingsPatch } from "@jskit-ai/users-core/shared/workspaceSettingsPatch";
import { USERS_WEB_QUERY_KEYS } from "../lib/queryKeys.js";
import { useAddEditScreen } from "../composables/useAddEditScreen.js";

const DEFAULT_WORKSPACE_COLOR = "#0F6B54";

function parseTextList(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[\n,;]+/)
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

const workspaceForm = reactive({
  name: "",
  color: DEFAULT_WORKSPACE_COLOR,
  avatarUrl: "",
  invitesEnabled: false,
  invitesAvailable: false,
  appDenyEmailsText: "",
  appDenyUserIdsText: ""
});

const addEdit = useAddEditScreen({
  apiSuffix: "/settings",
  queryKeyFactory: USERS_WEB_QUERY_KEYS.workspaceSettings,
  viewPermissions: ["workspace.settings.view", "workspace.settings.update"],
  savePermissions: ["workspace.settings.update"],
  placementSource: "users-web.workspace-settings-view",
  missingWorkspaceSlugError: "Workspace slug is required in the URL.",
  fallbackLoadError: "Unable to load workspace settings.",
  fallbackSaveError: "Unable to update workspace settings.",
  model: workspaceForm,
  parseInput: parseWorkspaceSettingsPatch,
  mapLoadedToModel: (model, payload = {}) => {
    const workspace = payload?.workspace && typeof payload.workspace === "object" ? payload.workspace : {};
    const settings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
    const appSurfaceAccess =
      settings.appSurfaceAccess && typeof settings.appSurfaceAccess === "object" ? settings.appSurfaceAccess : {};
    const denyEmails = Array.isArray(settings.appDenyEmails) ? settings.appDenyEmails : appSurfaceAccess.denyEmails;
    const denyUserIds = Array.isArray(settings.appDenyUserIds) ? settings.appDenyUserIds : appSurfaceAccess.denyUserIds;

    model.name = String(workspace.name || "");
    model.color = String(workspace.color || DEFAULT_WORKSPACE_COLOR);
    model.avatarUrl = String(workspace.avatarUrl || "");
    model.invitesEnabled = settings.invitesEnabled !== false;
    model.invitesAvailable = settings.invitesAvailable !== false;
    model.appDenyEmailsText = Array.isArray(denyEmails)
      ? denyEmails
          .map((entry) => String(entry || "").trim().toLowerCase())
          .filter(Boolean)
          .join("\n")
      : "";
    model.appDenyUserIdsText = Array.isArray(denyUserIds)
      ? denyUserIds
          .map((entry) => Number(entry))
          .filter((entry) => Number.isInteger(entry) && entry > 0)
          .join("\n")
      : "";
  },
  buildRawPayload: (model) => ({
    name: model.name,
    color: model.color,
    avatarUrl: model.avatarUrl,
    invitesEnabled: model.invitesEnabled,
    appDenyEmails: parseTextList(model.appDenyEmailsText),
    appDenyUserIds: parseTextList(model.appDenyUserIdsText)
  }),
  messages: {
    validation: "Fix invalid workspace settings values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings."
  }
});
</script>
