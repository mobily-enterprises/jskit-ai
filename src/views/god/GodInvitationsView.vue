<template>
  <section class="god-invitations-view py-2 py-md-4">
    <v-card rounded="lg" elevation="1" border>
      <v-card-item>
        <v-card-title class="text-h6">God invitations</v-card-title>
        <v-card-subtitle>Accept or refuse pending god-surface invites.</v-card-subtitle>
      </v-card-item>
      <v-divider />
      <v-card-text>
        <v-list density="comfortable" class="pa-0">
          <v-list-item v-for="invite in pendingInvites" :key="invite.id" class="px-0">
            <template #title>
              {{ invite.email }}
            </template>
            <template #subtitle>
              Role: {{ invite.roleId }} • expires {{ invite.expiresAt }}
            </template>
            <template #append>
              <div class="d-flex ga-2">
                <v-btn
                  color="primary"
                  variant="tonal"
                  :loading="inviteAction.token === invite.token && inviteAction.decision === 'accept'"
                  @click="acceptInvite(invite)"
                >
                  Accept
                </v-btn>
                <v-btn
                  color="error"
                  variant="text"
                  :loading="inviteAction.token === invite.token && inviteAction.decision === 'refuse'"
                  @click="refuseInvite(invite)"
                >
                  Refuse
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>

        <p v-if="pendingInvites.length < 1" class="text-body-2 text-medium-emphasis mb-0">No pending invites.</p>

        <v-alert v-if="message" :type="messageType" variant="tonal" class="mt-3 mb-0">
          {{ message }}
        </v-alert>
      </v-card-text>
    </v-card>
  </section>
</template>

<script setup>
import { toRefs } from "vue";
import { useGodInvitationsView } from "./useGodInvitationsView.js";

const { feedback, selection, collections, actions } = useGodInvitationsView();
const { message, messageType } = toRefs(feedback);
const { inviteAction } = toRefs(selection);
const { pendingInvites } = toRefs(collections);
const { acceptInvite, refuseInvite } = actions;
</script>
