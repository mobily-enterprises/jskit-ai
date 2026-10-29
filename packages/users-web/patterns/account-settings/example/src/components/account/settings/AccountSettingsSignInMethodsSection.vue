<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const signInMethods = props.runtime.signInMethods;
</script>

<template>
  <v-sheet rounded="lg" border class="account-settings-section">
    <v-list lines="two" class="py-0">
      <v-list-item
        v-for="method in signInMethods.methods.value"
        :key="method.provider"
        :title="method.label"
        :subtitle="method.linked ? 'Linked' : 'Not linked'"
      >
        <template #append>
          <v-btn
            v-if="method.linked"
            variant="text"
            color="error"
            :loading="signInMethods.unlinkingProvider.value === method.provider"
            :disabled="!method.canUnlink || signInMethods.isRefreshing.value"
            @click="signInMethods.unlink(method.provider)"
          >
            Unlink
          </v-btn>
          <v-btn
            v-else
            variant="tonal"
            color="primary"
            :disabled="!method.canLink || signInMethods.isRefreshing.value"
            @click="signInMethods.link(method.provider)"
          >
            Link
          </v-btn>
        </template>
      </v-list-item>
    </v-list>
    <p
      v-if="signInMethods.methods.value.some((method) => method.linked && !method.canUnlink)"
      class="account-settings-section__hint text-body-2 text-medium-emphasis mb-0"
    >
      Your only sign-in method can't be unlinked. Set a password or link another provider first.
    </p>
  </v-sheet>
</template>

<style scoped>
.account-settings-section {
  overflow: hidden;
}

.account-settings-section__hint {
  padding: 0 1rem 1rem;
}

@media (max-width: 640px) {
  .account-settings-section :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
