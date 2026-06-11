<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const notifications = props.runtime.notifications;
</script>

<template>
  <v-sheet rounded="lg" border class="account-settings-section">
    <header class="account-settings-section__header">
      <h2 class="account-settings-section__title">Notifications</h2>
    </header>
    <div class="account-settings-section__body">
      <v-form @submit.prevent="notifications.submit" novalidate>
        <v-switch
          v-model="notifications.form.productUpdates"
          label="Product updates"
          color="primary"
          hide-details
          :disabled="notifications.isSaving.value || notifications.isRefreshing.value"
          class="mb-2"
        />
        <v-switch
          v-model="notifications.form.accountActivity"
          label="Account activity alerts"
          color="primary"
          hide-details
          :disabled="notifications.isSaving.value || notifications.isRefreshing.value"
          class="mb-2"
        />
        <v-switch
          v-model="notifications.form.securityAlerts"
          label="Security alerts (required)"
          color="primary"
          hide-details
          disabled
          class="mb-4"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="notifications.isSaving.value"
          :disabled="notifications.isRefreshing.value"
        >
          Save notification settings
        </v-btn>
      </v-form>
    </div>
  </v-sheet>
</template>

<style scoped>
.account-settings-section {
  overflow: hidden;
}

.account-settings-section__header {
  padding: 1rem 1rem 0;
}

.account-settings-section__title {
  font-size: 1rem;
  font-weight: 650;
  line-height: 1.2;
  margin: 0;
}

.account-settings-section__body {
  padding: 1rem;
}

@media (max-width: 640px) {
  .account-settings-section__body :deep(.v-btn) {
    min-height: 48px;
  }
}
</style>
