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
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Preferences</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
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
              :error-messages="preferences.fieldErrors.avatarSize ? [preferences.fieldErrors.avatarSize] : []"
            />
          </v-col>
        </v-row>

        <v-btn type="submit" color="primary" :loading="preferences.isSaving.value">Save preferences</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>
