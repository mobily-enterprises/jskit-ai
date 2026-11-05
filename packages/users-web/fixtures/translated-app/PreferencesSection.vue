<script setup>
import { useI18n } from "vue-i18n";

// An app's own settings section: its words come from the app's messages, its
// choices, feedback and field errors from JSKIT.
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});
const { t } = useI18n();
const preferences = props.runtime.preferences;
</script>

<template>
  <v-form novalidate @submit.prevent="preferences.submit">
    <v-select
      v-model="preferences.form.theme"
      :items="preferences.options.theme"
      :label="t('app.settings.theme')"
      :error-messages="preferences.fieldErrors.theme"
      data-testid="theme-select"
    />
    <v-btn type="submit" data-testid="preferences-save" :loading="preferences.isSaving.value">
      {{ t("app.settings.save") }}
    </v-btn>
  </v-form>
</template>
