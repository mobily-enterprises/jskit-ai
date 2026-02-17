<template>
  <section class="workspaces-view py-6">
    <v-container class="mx-auto" max-width="860">
      <v-card rounded="lg" border elevation="1">
        <v-card-item>
          <v-card-title class="text-h6">You are logged in</v-card-title>
          <v-card-subtitle>Select a workspace or respond to invitations.</v-card-subtitle>
        </v-card-item>
        <v-divider />

        <v-card-text class="pt-4">
          <v-alert v-if="message" :type="messageType" variant="tonal" class="mb-4">
            {{ message }}
          </v-alert>

          <v-row>
            <v-col cols="12" md="6">
              <div class="text-subtitle-2 mb-2">Your workspaces</div>
              <template v-if="workspaceItems.length === 0">
                <p class="text-body-1 mb-2">You do not have a workspace yet.</p>
                <p class="text-body-2 text-medium-emphasis mb-0">
                  Ask an administrator for an invite, or create one after policy is enabled.
                </p>
              </template>

              <template v-else>
                <v-list density="comfortable" class="pa-0">
                  <v-list-item
                    v-for="workspace in workspaceItems"
                    :key="workspace.id"
                    :title="workspace.name"
                    :subtitle="
                      workspace.isAccessible
                        ? `/${workspace.slug} • role: ${workspace.roleId || 'member'}`
                        : `/${workspace.slug} • unavailable on this surface`
                    "
                    class="px-0"
                  >
                    <template #prepend>
                      <v-avatar :style="workspaceAvatarStyle(workspace)" size="28">
                        <v-img v-if="workspace.avatarUrl" :src="workspace.avatarUrl" cover />
                        <span v-else class="text-caption">{{ workspaceInitials(workspace) }}</span>
                      </v-avatar>
                    </template>
                    <template #append>
                      <v-btn
                        color="primary"
                        size="small"
                        variant="tonal"
                        :disabled="!workspace.isAccessible"
                        :loading="selectingWorkspaceSlug === workspace.slug"
                        @click="openWorkspace(workspace.slug)"
                      >
                        {{ workspace.isAccessible ? "Open" : "Unavailable" }}
                      </v-btn>
                    </template>
                  </v-list-item>
                </v-list>
              </template>
            </v-col>

            <v-col cols="12" md="6">
              <div class="text-subtitle-2 mb-2">Invitations</div>
              <template v-if="pendingInvites.length === 0">
                <p class="text-body-2 text-medium-emphasis mb-0">No pending invitations.</p>
              </template>

              <template v-else>
                <v-list density="comfortable" class="pa-0">
                  <v-list-item
                    v-for="invite in pendingInvites"
                    :key="invite.id"
                    :title="invite.workspaceName"
                    :subtitle="`Role: ${invite.roleId}`"
                    class="px-0"
                  >
                    <template #prepend>
                      <v-avatar color="warning" size="28">
                        <span class="text-caption font-weight-bold">?</span>
                      </v-avatar>
                    </template>
                    <template #append>
                      <div class="d-flex ga-2">
                        <v-btn
                          size="small"
                          variant="text"
                          color="error"
                          :loading="inviteAction.id === invite.id && inviteAction.decision === 'refuse'"
                          @click="refuseInvite(invite)"
                        >
                          Refuse
                        </v-btn>
                        <v-btn
                          size="small"
                          variant="tonal"
                          color="primary"
                          :loading="inviteAction.id === invite.id && inviteAction.decision === 'accept'"
                          @click="acceptInvite(invite)"
                        >
                          Join
                        </v-btn>
                      </div>
                    </template>
                  </v-list-item>
                </v-list>
              </template>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-container>
  </section>
</template>

<script setup>
import { toRefs } from "vue";
import { useWorkspacesView } from "./useWorkspacesView";

const { meta, state, actions } = useWorkspacesView();
const {
  message,
  messageType,
  selectingWorkspaceSlug,
  inviteAction,
  workspaceItems,
  pendingInvites
} = toRefs(state);
const { workspaceInitials, workspaceAvatarStyle } = meta;
const { openWorkspace, acceptInvite, refuseInvite } = actions;
</script>
