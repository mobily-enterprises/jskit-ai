<template>
  <section class="workspace-members-page">
    <div v-if="loadError" class="workspace-members-page__state">
      <p class="text-body-2 text-medium-emphasis mb-4">{{ loadError }}</p>
      <v-btn
        v-if="canRetryLoad"
        color="primary"
        variant="tonal"
        :loading="isRetryingLoad"
        @click="refreshLoad"
      >
        {{ t("jskit.workspaces.common.retry") }}
      </v-btn>
    </div>

    <MembersAdminClientElement
      v-else
      :forms="forms"
      :options="options"
      :collections="collections"
      :permissions="permissionState"
      :revokeInviteId="revokeInviteId"
      :removeMemberUserId="removeMemberUserId"
      :status="status"
      :actions="actions"
    />
  </section>
</template>

<script setup>
import MembersAdminClientElement from "./MembersAdminClientElement.vue";
import { useWorkspaceMembersPage } from "../composables/useWorkspaceMembersPage.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const {
  forms,
  options,
  collections,
  permissionState,
  revokeInviteId,
  removeMemberUserId,
  status,
  actions,
  loadError,
  canRetryLoad,
  isRetryingLoad,
  refreshLoad
} = useWorkspaceMembersPage();
</script>

<style scoped>
.workspace-members-page__state {
  margin-inline: auto;
  max-width: 30rem;
  padding: 2rem 1rem;
  text-align: center;
}

@media (max-width: 640px) {
  .workspace-members-page__state :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
