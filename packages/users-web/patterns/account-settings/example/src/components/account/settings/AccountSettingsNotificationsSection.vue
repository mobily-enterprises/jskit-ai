<script setup>
import { computed } from "vue";
import EditConflictNotice from "@jskit-ai/http-web/client/components/EditConflictNotice";
import { vPending } from "@jskit-ai/shell-web/client/directives/vPending";

const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const notifications = props.runtime.notifications;

// The settings read again (another session saved them) keep what the person switched; the notice names each switch
// whose server value changed meanwhile.
const FIELD_LABELS = Object.freeze({ productUpdates: "Product updates", accountActivity: "Account activity alerts" });
const conflictItems = computed(() =>
  notifications.conflicts.value.map(({ key, value }) => ({ key, label: FIELD_LABELS[key] || key, value: value ? "On" : "Off" }))
);
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
          :disabled="notifications.isSaving.value"
          class="mb-2"
        />
        <v-switch
          v-model="notifications.form.accountActivity"
          label="Account activity alerts"
          color="primary"
          hide-details
          :disabled="notifications.isSaving.value"
          class="mb-2"
        />
        <v-switch
          v-model="notifications.form.securityAlerts"
          label="Security alerts (required)"
          color="primary"
          hide-details
          disabled
        />
        <v-btn
          type="submit"
          color="primary"
          class="mt-4"
          :loading="notifications.isSaving.value"
          v-pending="notifications.isSaving.value || notifications.isRefreshing.value"
        >
          Save notification settings
        </v-btn>
        <EditConflictNotice
          :items="conflictItems"
          @accept="notifications.acceptServerValue"
          @keep="notifications.keepOwnValue"
        />
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
