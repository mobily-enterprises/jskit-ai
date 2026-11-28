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

const preferences = props.runtime.preferences;

// The settings read again (another session saved them) keep what the person chose; the notice names each field whose
// server value changed meanwhile, with that value as its list shows it.
const FIELDS = Object.freeze({
  theme: { label: "Theme", options: "theme" },
  locale: { label: "Language / locale", options: "locale" },
  timeZone: { label: "Time zone", options: "timeZone" },
  dateFormat: { label: "Date format", options: "dateFormat" },
  numberFormat: { label: "Number format", options: "numberFormat" },
  currencyCode: { label: "Currency", options: "currency" },
  avatarSize: { label: "Avatar size", options: "avatarSize" }
});
const conflictItems = computed(() =>
  preferences.conflicts.value.map(({ key, value }) => {
    const field = FIELDS[key] || { label: key, options: "" };
    const option = (preferences.options[field.options] || []).find((entry) => entry?.value === value);
    return { key, label: field.label, value: String(option?.title ?? value ?? "") };
  })
);
</script>

<template>
  <div class="account-settings-section">
    <div class="account-settings-section__body">
      <v-form @submit.prevent="preferences.submit" novalidate>
        <v-row>
          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.theme"
              label="Theme"
              :items="preferences.options.theme"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.theme"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.locale"
              label="Language / locale"
              :items="preferences.options.locale"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.locale"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.timeZone"
              label="Time zone"
              :items="preferences.options.timeZone"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.timeZone"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.dateFormat"
              label="Date format"
              :items="preferences.options.dateFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.dateFormat"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.numberFormat"
              label="Number format"
              :items="preferences.options.numberFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.numberFormat"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.currencyCode"
              label="Currency"
              :items="preferences.options.currency"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.currencyCode"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model.number="preferences.form.avatarSize"
              label="Avatar size"
              :items="preferences.options.avatarSize"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value"
              :error-messages="preferences.fieldErrors.avatarSize"
            />
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          class="mt-4"
          :loading="preferences.isSaving.value"
          v-pending="preferences.isSaving.value || preferences.isRefreshing.value"
        >
          Save preferences
        </v-btn>
        <EditConflictNotice
          :items="conflictItems"
          @accept="preferences.acceptServerValue"
          @keep="preferences.keepOwnValue"
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
