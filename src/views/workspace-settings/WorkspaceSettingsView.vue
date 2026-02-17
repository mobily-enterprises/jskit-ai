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

    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1">Invite people</v-card-title>
            <v-card-subtitle>Send workspace invites with a role.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert
              v-if="!workspaceForm.invitesAvailable"
              type="warning"
              variant="tonal"
              class="mb-3"
            >
              Invites are disabled by app policy or role manifest.
            </v-alert>
            <v-alert v-else-if="!workspaceForm.invitesEnabled" type="info" variant="tonal" class="mb-3">
              Invites are currently off for this workspace.
            </v-alert>

            <template v-if="canInviteMembers && workspaceForm.invitesAvailable && workspaceForm.invitesEnabled">
              <v-form @submit.prevent="submitInvite" novalidate>
                <v-text-field
                  v-model="inviteForm.email"
                  label="Email"
                  variant="outlined"
                  density="comfortable"
                  type="email"
                  autocomplete="email"
                  class="mb-3"
                />
                <v-select
                  v-model="inviteForm.roleId"
                  label="Role"
                  :items="inviteRoleOptions"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  density="comfortable"
                  class="mb-3"
                />
                <v-btn type="submit" color="primary" :loading="isCreatingInvite">Send invite</v-btn>
              </v-form>
            </template>

            <v-alert v-if="inviteMessage" :type="inviteMessageType" variant="tonal" class="mt-3 mb-0">
              {{ inviteMessage }}
            </v-alert>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" lg="7">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1">Team</v-card-title>
            <v-card-subtitle>Members and pending invites.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="!canViewMembers" type="info" variant="tonal" class="mb-0">
              You do not have permission to view workspace members.
            </v-alert>

            <template v-else>
              <div class="text-caption text-medium-emphasis mb-2">Members</div>
              <v-list density="comfortable" class="pa-0 mb-3">
                <v-list-item v-for="member in membersList" :key="member.userId" class="px-0">
                  <template #title>
                    <div class="d-flex align-center ga-2">
                      <span>{{ member.displayName || member.email }}</span>
                      <v-chip v-if="member.isOwner" size="x-small" label color="secondary">Owner</v-chip>
                    </div>
                  </template>
                  <template #subtitle>
                    {{ member.email }}
                  </template>

                  <template #append>
                    <div class="d-flex align-center ga-2">
                      <v-select
                        v-model="member.roleId"
                        :items="memberRoleOptions"
                        item-title="title"
                        item-value="value"
                        density="compact"
                        variant="outlined"
                        hide-details
                        class="member-role-select"
                        :disabled="!canManageMembers || member.isOwner"
                        @update:model-value="(value) => submitMemberRoleUpdate(member, value)"
                      />
                    </div>
                  </template>
                </v-list-item>
              </v-list>

              <v-divider class="mb-3" />

              <div class="text-caption text-medium-emphasis mb-2">Pending invites</div>
              <v-list density="comfortable" class="pa-0">
                <v-list-item v-for="invite in invites" :key="invite.id" class="px-0">
                  <template #title>
                    {{ invite.email }}
                  </template>
                  <template #subtitle>
                    Role: {{ invite.roleId }} • expires {{ formatDateTime(invite.expiresAt) }}
                  </template>
                  <template #append>
                    <v-btn
                      v-if="canRevokeInvites"
                      variant="text"
                      color="error"
                      :loading="revokeInviteId === invite.id && isRevokingInvite"
                      @click="submitRevokeInvite(invite.id)"
                    >
                      Revoke
                    </v-btn>
                  </template>
                </v-list-item>
                <p v-if="invites.length < 1" class="text-body-2 text-medium-emphasis mb-0">No pending invites.</p>
              </v-list>

              <v-alert v-if="teamMessage" :type="teamMessageType" variant="tonal" class="mt-3 mb-0">
                {{ teamMessage }}
              </v-alert>
            </template>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </section>
</template>

<script setup>
import { toRefs } from "vue";
import { useWorkspaceSettingsView } from "./useWorkspaceSettingsView";

const { forms, options, feedback, members, permissions, status, actions } = useWorkspaceSettingsView();
const { workspace: workspaceForm, invite: inviteForm } = forms;
const {
  workspaceError,
  workspaceMessage,
  workspaceMessageType,
  inviteMessage,
  inviteMessageType,
  teamMessage,
  teamMessageType,
  revokeInviteId
} = toRefs(feedback);
const {
  list: membersList,
  invites
} = toRefs(members);
const {
  canManageWorkspaceSettings,
  canViewMembers,
  canInviteMembers,
  canManageMembers,
  canRevokeInvites
} = toRefs(permissions);
const {
  isSavingWorkspaceSettings,
  isCreatingInvite,
  isRevokingInvite
} = toRefs(status);
const {
  mode: modeOptions,
  timing: timingOptions,
  inviteRoles: inviteRoleOptions,
  memberRoles: memberRoleOptions,
  formatDateTime
} = options;
const { submitWorkspaceSettings, submitInvite, submitRevokeInvite, submitMemberRoleUpdate } = actions;
</script>

<style scoped>
.member-role-select {
  width: 160px;
}
</style>
