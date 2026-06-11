<script setup>
import { useAccountSettingsInvitesSectionRuntime } from "../account-settings/useAccountSettingsInvitesSectionRuntime.js";

const invites = useAccountSettingsInvitesSectionRuntime();
</script>

<template>
  <v-sheet rounded="lg" border class="account-invites-section">
    <header class="account-invites-section__header">
      <h2 class="account-invites-section__title">Invitations</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">Accept or refuse workspace invitations.</p>
    </header>

    <div class="account-invites-section__body">
      <template v-if="invites.isLoading.value">
        <v-skeleton-loader type="text@2, list-item-two-line@3" />
      </template>

      <template v-else-if="invites.items.value.length < 1">
        <v-progress-linear v-if="invites.isRefetching.value" indeterminate class="mb-4" />
        <p class="text-body-2 text-medium-emphasis mb-0">No pending invitations.</p>
      </template>

      <template v-else>
        <v-progress-linear v-if="invites.isRefetching.value" indeterminate class="mb-4" />
        <v-list density="comfortable" class="pa-0">
          <v-list-item
            v-for="invite in invites.items.value"
            :key="invite.id"
            :title="invite.workspaceName"
            :subtitle="`/${invite.workspaceSlug} • role: ${invite.roleSid}`"
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
                  :loading="invites.action.value.token === invite.token && invites.action.value.decision === 'refuse'"
                  :disabled="
                    invites.isRefetching.value || (invites.isResolving.value && invites.action.value.token !== invite.token)
                  "
                  @click="invites.refuse(invite)"
                >
                  Refuse
                </v-btn>
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  :loading="invites.action.value.token === invite.token && invites.action.value.decision === 'accept'"
                  :disabled="
                    invites.isRefetching.value || (invites.isResolving.value && invites.action.value.token !== invite.token)
                  "
                  @click="invites.accept(invite)"
                >
                  Join
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </template>
    </div>
  </v-sheet>
</template>

<style scoped>
.account-invites-section {
  overflow: hidden;
}

.account-invites-section__header {
  padding: 1rem 1rem 0;
}

.account-invites-section__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.2;
  margin: 0 0 0.25rem;
}

.account-invites-section__body {
  padding: 1rem;
}

@media (max-width: 640px) {
  .account-invites-section__body :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
