<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Preferences</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="actions.submitPreferences" novalidate>
        <v-row>
          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.theme"
              label="Theme"
              :items="meta.themeOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.theme ? [state.preferencesFieldErrors.theme] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.locale"
              label="Language / locale"
              :items="meta.localeOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.locale ? [state.preferencesFieldErrors.locale] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.timeZone"
              label="Time zone"
              :items="meta.timeZoneOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.timeZone ? [state.preferencesFieldErrors.timeZone] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.dateFormat"
              label="Date format"
              :items="meta.dateFormatOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.dateFormat ? [state.preferencesFieldErrors.dateFormat] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.numberFormat"
              label="Number format"
              :items="meta.numberFormatOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.numberFormat ? [state.preferencesFieldErrors.numberFormat] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="state.preferencesForm.currencyCode"
              label="Currency"
              :items="meta.currencyOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.currencyCode ? [state.preferencesFieldErrors.currencyCode] : []"
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model.number="state.preferencesForm.avatarSize"
              label="Avatar size"
              :items="meta.avatarSizeOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="state.preferencesFieldErrors.avatarSize ? [state.preferencesFieldErrors.avatarSize] : []"
            />
          </v-col>
        </v-row>

        <v-alert v-if="state.preferencesMessage" :type="state.preferencesMessageType" variant="tonal" class="mb-3">
          {{ state.preferencesMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="state.preferencesMutation.isPending.value">Save preferences</v-btn>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { useSettingsPreferencesForm } from "./useSettingsPreferencesForm";

const { meta, state, actions } = useSettingsPreferencesForm();
</script>
