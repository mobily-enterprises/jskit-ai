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
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Notifications</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="notifications.submit" novalidate>
        <v-switch
          v-model="notifications.form.productUpdates"
          label="Product updates"
          color="primary"
          hide-details
          class="mb-2"
        />
        <v-switch
          v-model="notifications.form.accountActivity"
          label="Account activity alerts"
          color="primary"
          hide-details
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
        <v-btn type="submit" color="primary" :loading="notifications.isSaving.value">
          Save notification settings
        </v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>
