import { reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api";
import { AVATAR_DEFAULT_SIZE } from "../../../../shared/avatar/index.js";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig";
import { useSettingsContext } from "../lib/useSettingsContext";
import { useSettingsPreferencesLogic } from "./lib/useSettingsPreferencesLogic";
import {
  avatarSizeOptions,
  currencyOptions,
  dateFormatOptions,
  localeOptions,
  numberFormatOptions,
  themeOptions,
  timeZoneOptions
} from "./lib/settingsPreferencesOptions";

export function useSettingsPreferencesForm(options) {
  if (!options) {
    return useSettingsContext().sections.preferences;
  }

  const {
    vuetifyTheme,
    queryClient,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    applySettingsData
  } = options;

  const preferencesForm = reactive({
    theme: "system",
    locale: "en-US",
    timeZone: "UTC",
    dateFormat: "system",
    numberFormat: "system",
    currencyCode: "USD",
    avatarSize: AVATAR_DEFAULT_SIZE
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
    mutationFn: (payload) => api.updatePreferencesSettings(payload)
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

    preferencesForm.theme = String(data.preferences?.theme || "system");
    preferencesForm.locale = String(data.preferences?.locale || "en-US");
    preferencesForm.timeZone = String(data.preferences?.timeZone || "UTC");
    preferencesForm.dateFormat = String(data.preferences?.dateFormat || "system");
    preferencesForm.numberFormat = String(data.preferences?.numberFormat || "system");
    preferencesForm.currencyCode = String(data.preferences?.currencyCode || "USD");
    preferencesForm.avatarSize = Number(data.preferences?.avatarSize || AVATAR_DEFAULT_SIZE);

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
