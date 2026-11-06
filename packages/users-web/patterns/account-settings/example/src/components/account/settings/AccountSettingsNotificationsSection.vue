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
  <div class="account-settings-section">
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
  </div>
</template>

<style scoped>
.account-settings-section {
  overflow: hidden;
}

.account-settings-section__body {
  padding: 1rem;
}
</style>
