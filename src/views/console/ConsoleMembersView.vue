<template>
  <section class="console-members-view py-2 py-md-4">
    <v-row>
      <v-col cols="12" lg="5">
        <v-card rounded="lg" elevation="1" border>
          <v-card-item>
            <v-card-title class="text-subtitle-1">Invite console members</v-card-title>
            <v-card-subtitle>Invite users as `devop` or `moderator`.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="!canInviteMembers" type="info" variant="tonal" class="mb-3">
              You do not have permission to send console invites.
            </v-alert>

            <template v-else>
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
            <v-card-title class="text-subtitle-1">Console members and invites</v-card-title>
            <v-card-subtitle>Manage global console-surface roles.</v-card-subtitle>
          </v-card-item>
          <v-divider />
          <v-card-text>
            <v-alert v-if="membersMessage" :type="membersMessageType" variant="tonal" class="mb-3">
              {{ membersMessage }}
            </v-alert>

            <v-alert v-if="!canViewMembers" type="info" variant="tonal" class="mb-0">
              You do not have permission to view console members.
            </v-alert>

            <template v-else>
              <div class="text-caption text-medium-emphasis mb-2">Members</div>
              <v-list density="comfortable" class="pa-0 mb-3">
                <v-list-item v-for="member in members" :key="member.userId" class="px-0">
                  <template #title>
                    <div class="d-flex align-center ga-2">
                      <span>{{ member.displayName || member.email }}</span>
                      <v-chip v-if="member.isConsole" size="x-small" label color="secondary">Console</v-chip>
                    </div>
                  </template>
                  <template #subtitle>
                    {{ member.email }}
                  </template>

                  <template #append>
                    <v-select
                      v-model="member.roleId"
                      :items="memberRoleOptions"
                      item-title="title"
                      item-value="value"
                      density="compact"
                      variant="outlined"
                      hide-details
                      class="member-role-select"
                      :disabled="!canManageMembers || member.isConsole"
                      @update:model-value="(value) => submitMemberRoleUpdate(member, value)"
                    />
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
import { useConsoleMembersView } from "./useConsoleMembersView.js";

const { forms, options, collections, permissions, feedback, status, actions } = useConsoleMembersView();

const { invite: inviteForm } = forms;
const { inviteRoleOptions, memberRoleOptions, formatDateTime } = options;
const { members, invites } = toRefs(collections);
const { canViewMembers, canInviteMembers, canManageMembers, canRevokeInvites } = toRefs(permissions);
const {
  membersMessage,
  membersMessageType,
  inviteMessage,
  inviteMessageType,
  teamMessage,
  teamMessageType,
  revokeInviteId
} = toRefs(feedback);
const { isCreatingInvite, isRevokingInvite } = toRefs(status);
const { submitInvite, submitRevokeInvite, submitMemberRoleUpdate } = actions;
</script>

<style scoped>
.member-role-select {
  width: 160px;
}
</style>
