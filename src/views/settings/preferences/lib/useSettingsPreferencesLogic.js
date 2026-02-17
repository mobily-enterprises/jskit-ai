export function useSettingsPreferencesLogic({
  vuetifyTheme,
  preferencesForm,
  preferencesFieldErrors,
  preferencesMessage,
  preferencesMessageType,
  preferencesMutation,
  settingsQueryKey,
  queryClient,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  applySettingsData
}) {
  function applyThemePreference(themePreference) {
    const preference = String(themePreference || "system").toLowerCase();
    if (preference === "dark") {
      vuetifyTheme.global.name.value = "dark";
      return;
    }
    if (preference === "light") {
      vuetifyTheme.global.name.value = "light";
      return;
    }

    const prefersDark =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : false;
    vuetifyTheme.global.name.value = prefersDark ? "dark" : "light";
  }

  async function submitPreferences() {
    clearFieldErrors(preferencesFieldErrors);
    preferencesMessage.value = "";

    try {
      const data = await preferencesMutation.mutateAsync({
        theme: preferencesForm.theme,
        locale: preferencesForm.locale,
        timeZone: preferencesForm.timeZone,
        dateFormat: preferencesForm.dateFormat,
        numberFormat: preferencesForm.numberFormat,
        currencyCode: preferencesForm.currencyCode,
        avatarSize: Number(preferencesForm.avatarSize)
      });

      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);
      preferencesMessageType.value = "success";
      preferencesMessage.value = "Preferences updated.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      if (error?.fieldErrors && typeof error.fieldErrors === "object") {
        for (const key of Object.keys(preferencesFieldErrors)) {
          if (error.fieldErrors[key]) {
            preferencesFieldErrors[key] = String(error.fieldErrors[key]);
          }
        }
      }

      preferencesMessageType.value = "error";
      preferencesMessage.value = toErrorMessage(error, "Unable to update preferences.");
    }
  }

  return {
    applyThemePreference,
    submitPreferences
  };
}
