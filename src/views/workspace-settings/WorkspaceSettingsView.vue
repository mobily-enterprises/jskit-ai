<template>
  <section class="workspace-settings-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border class="mb-4">
      <v-card-item>
        <v-card-title class="text-h6">Workspace settings</v-card-title>
        <v-card-subtitle>These values apply to everyone in this workspace.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text class="pt-4">
        <v-alert v-if="workspaceError" type="error" variant="tonal" class="mb-4">
          {{ workspaceError }}
        </v-alert>

        <v-form @submit.prevent="submitWorkspaceSettings" novalidate>
          <v-row>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="workspaceForm.name"
                label="Workspace name"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model="workspaceForm.color"
                label="Workspace color"
                type="color"
                variant="outlined"
                density="comfortable"
                :disabled="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="5">
              <v-text-field
                v-model="workspaceForm.avatarUrl"
                label="Workspace avatar URL"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                placeholder="https://..."
                hint="Optional"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" md="4">
              <v-select
                v-model="workspaceForm.defaultMode"
                label="Default mode"
                :items="modeOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-select
                v-model="workspaceForm.defaultTiming"
                label="Default timing"
                :items="timingOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model.number="workspaceForm.defaultPaymentsPerYear"
                type="number"
                min="1"
                max="365"
                label="Payments/year"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>
            <v-col cols="12" md="2">
              <v-text-field
                v-model.number="workspaceForm.defaultHistoryPageSize"
                type="number"
                min="1"
                max="100"
                label="History rows"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
              />
            </v-col>

            <v-col cols="12" md="6" class="d-flex align-center">
              <v-switch
                v-model="workspaceForm.invitesEnabled"
                color="primary"
                hide-details
                label="Enable invites"
                :disabled="!canManageWorkspaceSettings || !workspaceForm.invitesAvailable"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-select
                v-model="workspaceForm.assistantTranscriptMode"
                label="Assistant transcript mode"
                :items="transcriptModeOptions"
                item-title="title"
                item-value="value"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                hint="Standard stores redacted content, restricted stores metadata only, disabled skips storage."
                persistent-hint
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="workspaceForm.assistantSystemPromptApp"
                label="Assistant system prompt (App surface)"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                hint="Optional. Tone and rules for assistant responses in the app surface."
                persistent-hint
                rows="4"
                auto-grow
              />
            </v-col>
            <v-col cols="12">
              <v-textarea
                v-model="workspaceForm.appDenyEmailsText"
                label="App surface deny list (emails)"
                variant="outlined"
                density="comfortable"
                :readonly="!canManageWorkspaceSettings"
                hint="Optional. One email per line. Denied users cannot access this workspace on the app surface."
                persistent-hint
                rows="4"
                auto-grow
              />
            </v-col>
            <v-col cols="12" md="6" class="d-flex align-center justify-end">
              <v-btn
                v-if="canManageWorkspaceSettings"
                type="submit"
                color="primary"
                :loading="isSavingWorkspaceSettings"
              >
                Save workspace settings
              </v-btn>
              <v-chip v-else color="secondary" label>Read-only</v-chip>
            </v-col>
          </v-row>
        </v-form>

        <v-alert v-if="workspaceMessage" :type="workspaceMessageType" variant="tonal" class="mt-4 mb-0">
          {{ workspaceMessage }}
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { toRefs } from "vue";
import { useWorkspaceSettingsView } from "./useWorkspaceSettingsView.js";

const { forms, options, feedback, permissions, status, actions } = useWorkspaceSettingsView({
  includeMembers: false
});
const { workspace: workspaceForm } = forms;
const { workspaceError, workspaceMessage, workspaceMessageType } = toRefs(feedback);
const { canManageWorkspaceSettings } = toRefs(permissions);
const { isSavingWorkspaceSettings } = toRefs(status);
const { mode: modeOptions, timing: timingOptions, transcriptModes: transcriptModeOptions } = options;
const { submitWorkspaceSettings } = actions;
</script>
