<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const preferences = props.runtime.preferences;
</script>

<template>
  <v-sheet rounded="lg" border class="account-settings-section">
    <header class="account-settings-section__header">
      <h2 class="account-settings-section__title">Preferences</h2>
    </header>
    <div class="account-settings-section__body">
      <v-form @submit.prevent="preferences.submit" novalidate>
        <v-row>
          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.theme"
              label="Theme"
              :items="preferences.options.theme"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.theme ? [preferences.fieldErrors.theme] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.locale"
              label="Language / locale"
              :items="preferences.options.locale"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.locale ? [preferences.fieldErrors.locale] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.timeZone"
              label="Time zone"
              :items="preferences.options.timeZone"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.timeZone ? [preferences.fieldErrors.timeZone] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.dateFormat"
              label="Date format"
              :items="preferences.options.dateFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.dateFormat ? [preferences.fieldErrors.dateFormat] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.numberFormat"
              label="Number format"
              :items="preferences.options.numberFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.numberFormat ? [preferences.fieldErrors.numberFormat] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="preferences.form.currencyCode"
              label="Currency"
              :items="preferences.options.currency"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.currencyCode ? [preferences.fieldErrors.currencyCode] : []"
            />
          </v-col>

          <v-col cols="12" md="3">
            <v-select
              v-model.number="preferences.form.avatarSize"
              label="Avatar size"
              :items="preferences.options.avatarSize"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.avatarSize ? [preferences.fieldErrors.avatarSize] : []"
            />
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          :loading="preferences.isSaving.value"
          :disabled="preferences.isRefreshing.value"
        >
          Save preferences
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
