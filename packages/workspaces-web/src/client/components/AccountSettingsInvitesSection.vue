<script setup>
import { useAccountSettingsInvitesSectionRuntime } from "../account-settings/useAccountSettingsInvitesSectionRuntime.js";
import { useJskitText } from "../i18n.js";

const { t } = useJskitText();

const invites = useAccountSettingsInvitesSectionRuntime();
</script>

<template>
  <div class="account-invites-section">
    <header class="account-invites-section__header">
      <h2 class="account-invites-section__title text-title-medium">{{ t("jskit.workspaces.common.invitations") }}</h2>
      <p class="text-body-medium on-surface-variant mb-0">{{ t("jskit.workspaces.accountInvites.subtitle") }}</p>
    </header>

    <div class="account-invites-section__body">
      <template v-if="invites.isLoading.value">
        <v-skeleton-loader type="text@2, list-item-two-line@3" />
      </template>

      <template v-else-if="invites.items.value.length < 1">
        <v-progress-linear v-if="invites.isRefetching.value" indeterminate class="mb-4" />
        <p class="text-body-medium on-surface-variant mb-0">{{ t("jskit.workspaces.common.noPendingInvitations") }}</p>
      </template>

      <template v-else>
        <v-progress-linear v-if="invites.isRefetching.value" indeterminate class="mb-4" />
        <v-list density="comfortable" class="pa-0">
          <v-list-item
            v-for="invite in invites.items.value"
            :key="invite.id"
            :title="invite.workspaceName"
            :subtitle="t('jskit.workspaces.common.slugAndRole', { slug: invite.workspaceSlug, role: invite.roleLabel || invite.roleSid })"
            class="px-0"
          >
            <template #prepend>
              <v-avatar color="warning" size="28">
                <span class="text-body-small font-weight-bold">{{ t("jskit.workspaces.common.pendingInviteMark") }}</span>
              </v-avatar>
            </template>
            <template #append>
              <div class="d-flex ga-2">
                <v-btn
                  variant="text"
                  color="error"
                  :loading="invites.action.value.token === invite.token && invites.action.value.decision === 'refuse'"
                  :disabled="
                    invites.isRefetching.value || (invites.isResolving.value && invites.action.value.token !== invite.token)
                  "
                  @click="invites.refuse(invite)"
                >
                  {{ t("jskit.workspaces.common.refuse") }}
                </v-btn>
                <v-btn
                  variant="tonal"
                  color="primary"
                  :loading="invites.action.value.token === invite.token && invites.action.value.decision === 'accept'"
                  :disabled="
                    invites.isRefetching.value || (invites.isResolving.value && invites.action.value.token !== invite.token)
                  "
                  @click="invites.accept(invite)"
                >
                  {{ t("jskit.workspaces.common.join") }}
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </template>
    </div>
  </div>
</template>

<style scoped>
.account-invites-section {
  overflow: hidden;
}

.account-invites-section__header {
  padding: 1rem 1rem 0;
}

.account-invites-section__title {
  margin: 0 0 0.25rem;
}

.account-invites-section__body {
  padding: 1rem;
}
</style>
