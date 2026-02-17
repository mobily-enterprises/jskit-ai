export function useSettingsPreferencesSection(settingsView) {
  const { meta, state, actions } = settingsView;

  return {
    meta: {
      themeOptions: meta.themeOptions,
      localeOptions: meta.localeOptions,
      timeZoneOptions: meta.timeZoneOptions,
      dateFormatOptions: meta.dateFormatOptions,
      numberFormatOptions: meta.numberFormatOptions,
      currencyOptions: meta.currencyOptions,
      avatarSizeOptions: meta.avatarSizeOptions
    },
    state: {
      preferencesForm: state.preferencesForm,
      preferencesFieldErrors: state.preferencesFieldErrors,
      preferencesMessage: state.preferencesMessage,
      preferencesMessageType: state.preferencesMessageType,
      preferencesMutation: state.preferencesMutation
    },
    actions: {
      submitPreferences: actions.submitPreferences
    }
  };
}
