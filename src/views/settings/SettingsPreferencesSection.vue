<template>
  <v-card rounded="lg" elevation="0" border>
    <v-card-item>
      <v-card-title class="text-subtitle-1">Preferences</v-card-title>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-form @submit.prevent="vm.submitPreferences" novalidate>
        <v-row>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.theme"
              label="Theme"
              :items="vm.themeOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.theme ? [vm.preferencesFieldErrors.theme] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.locale"
              label="Language / locale"
              :items="vm.localeOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.locale ? [vm.preferencesFieldErrors.locale] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.timeZone"
              label="Time zone"
              :items="vm.timeZoneOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.timeZone ? [vm.preferencesFieldErrors.timeZone] : []"
            />
          </v-col>

          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.dateFormat"
              label="Date format"
              :items="vm.dateFormatOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.dateFormat ? [vm.preferencesFieldErrors.dateFormat] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.numberFormat"
              label="Number format"
              :items="vm.numberFormatOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.numberFormat ? [vm.preferencesFieldErrors.numberFormat] : []"
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-select
              v-model="vm.preferencesForm.currencyCode"
              label="Currency"
              :items="vm.currencyOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.currencyCode ? [vm.preferencesFieldErrors.currencyCode] : []"
            />
          </v-col>
          <v-col cols="12" md="3">
            <v-select
              v-model.number="vm.preferencesForm.avatarSize"
              label="Avatar size"
              :items="vm.avatarSizeOptions"
              variant="outlined"
              density="comfortable"
              :error-messages="vm.preferencesFieldErrors.avatarSize ? [vm.preferencesFieldErrors.avatarSize] : []"
            />
          </v-col>
        </v-row>

        <v-alert v-if="vm.preferencesMessage" :type="vm.preferencesMessageType" variant="tonal" class="mb-3">
          {{ vm.preferencesMessage }}
        </v-alert>

        <v-btn type="submit" color="primary" :loading="vm.preferencesMutation.isPending.value">Save preferences</v-btn>
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
