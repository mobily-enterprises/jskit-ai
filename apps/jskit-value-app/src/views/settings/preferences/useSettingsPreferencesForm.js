import { reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api/index.js";
import { SETTINGS_DEFAULTS } from "../../../../shared/settings/model.js";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig.js";
import { useSettingsContext } from "../lib/useSettingsContext.js";
import { useSettingsPreferencesLogic } from "./lib/useSettingsPreferencesLogic.js";
import {
  avatarSizeOptions,
  currencyOptions,
  dateFormatOptions,
  localeOptions,
  numberFormatOptions,
  themeOptions,
  timeZoneOptions
} from "./lib/settingsPreferencesOptions.js";

export function useSettingsPreferencesForm(options) {
  if (!options) {
    return useSettingsContext().sections.preferences;
  }

  const { vuetifyTheme, queryClient, clearFieldErrors, toErrorMessage, handleAuthError, applySettingsData } = options;

  const preferencesForm = reactive({
    theme: SETTINGS_DEFAULTS.theme,
    locale: SETTINGS_DEFAULTS.locale,
    timeZone: SETTINGS_DEFAULTS.timeZone,
    dateFormat: SETTINGS_DEFAULTS.dateFormat,
    numberFormat: SETTINGS_DEFAULTS.numberFormat,
    currencyCode: SETTINGS_DEFAULTS.currencyCode,
    avatarSize: SETTINGS_DEFAULTS.avatarSize
  });

  const preferencesFieldErrors = reactive({
    theme: "",
    locale: "",
    timeZone: "",
    dateFormat: "",
    numberFormat: "",
    currencyCode: "",
    avatarSize: ""
  });

  const preferencesMessage = ref("");
  const preferencesMessageType = ref("success");

  const preferencesMutation = useMutation({
    mutationFn: (payload) => api.settings.updatePreferences(payload)
  });

  const { applyThemePreference, submitPreferences } = useSettingsPreferencesLogic({
    vuetifyTheme,
    preferencesForm,
    preferencesFieldErrors,
    preferencesMessage,
    preferencesMessageType,
    preferencesMutation,
    settingsQueryKey: SETTINGS_QUERY_KEY,
    queryClient,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData
  });

  function hydrate(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    preferencesForm.theme = String(data.preferences?.theme || SETTINGS_DEFAULTS.theme);
    preferencesForm.locale = String(data.preferences?.locale || SETTINGS_DEFAULTS.locale);
    preferencesForm.timeZone = String(data.preferences?.timeZone || SETTINGS_DEFAULTS.timeZone);
    preferencesForm.dateFormat = String(data.preferences?.dateFormat || SETTINGS_DEFAULTS.dateFormat);
    preferencesForm.numberFormat = String(data.preferences?.numberFormat || SETTINGS_DEFAULTS.numberFormat);
    preferencesForm.currencyCode = String(data.preferences?.currencyCode || SETTINGS_DEFAULTS.currencyCode);
    preferencesForm.avatarSize = Number(data.preferences?.avatarSize || SETTINGS_DEFAULTS.avatarSize);

    applyThemePreference(preferencesForm.theme);
  }

  return {
    meta: {
      themeOptions,
      localeOptions,
      timeZoneOptions,
      dateFormatOptions,
      numberFormatOptions,
      currencyOptions,
      avatarSizeOptions
    },
    state: reactive({
      preferencesForm,
      preferencesFieldErrors,
      preferencesMessage,
      preferencesMessageType,
      preferencesMutation
    }),
    actions: {
      submitPreferences,
      applyThemePreference
    },
    hydrate
  };
}
