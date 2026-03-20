<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const invites = props.runtime.invites;
</script>

<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Invitations</v-card-title>
      <v-card-subtitle>Accept or refuse workspace invitations.</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-progress-linear v-if="invites.isLoading.value" indeterminate class="mb-4" />

      <template v-if="invites.items.value.length < 1">
        <p class="text-body-2 text-medium-emphasis mb-0">No pending invitations.</p>
      </template>

      <template v-else>
        <v-list density="comfortable" class="pa-0">
          <v-list-item
            v-for="invite in invites.items.value"
            :key="invite.id"
            :title="invite.workspaceName"
            :subtitle="`/${invite.workspaceSlug} • role: ${invite.roleId}`"
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
                  :disabled="invites.isResolving.value && invites.action.value.token !== invite.token"
                  @click="invites.refuse(invite)"
                >
                  Refuse
                </v-btn>
                <v-btn
                  size="small"
                  variant="tonal"
                  color="primary"
                  :loading="invites.action.value.token === invite.token && invites.action.value.decision === 'accept'"
                  :disabled="invites.isResolving.value && invites.action.value.token !== invite.token"
                  @click="invites.accept(invite)"
                >
                  Join
                </v-btn>
              </div>
            </template>
          </v-list-item>
        </v-list>
      </template>
    </v-card-text>
  </v-card>
</template>
