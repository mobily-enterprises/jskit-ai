<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Notifications</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="vm.submitNotifications" novalidate>
        <v-switch
          v-model="vm.notificationsForm.productUpdates"
          label="Product updates"
          color="primary"
          hide-details
          class="mb-2"
        />
        <v-switch
          v-model="vm.notificationsForm.accountActivity"
          label="Account activity alerts"
          color="primary"
          hide-details
          class="mb-2"
        />
        <v-switch
          v-model="vm.notificationsForm.securityAlerts"
          label="Security alerts (required)"
          color="primary"
          hide-details
          disabled
          class="mb-4"
        />

        <v-alert v-if="vm.notificationsMessage" :type="vm.notificationsMessageType" variant="tonal" class="mb-3">
          {{ vm.notificationsMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="vm.notificationsMutation.isPending.value">
          Save notification settings
        </v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup>
defineProps({
  vm: {
    type: Object,
    required: true
  }
});
</script>
