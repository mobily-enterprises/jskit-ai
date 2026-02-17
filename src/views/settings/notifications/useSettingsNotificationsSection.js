export function useSettingsNotificationsSection(settingsView) {
  const { state, actions } = settingsView;

  return {
    meta: {},
    state: {
      notificationsForm: state.notificationsForm,
      notificationsMessage: state.notificationsMessage,
      notificationsMessageType: state.notificationsMessageType,
      notificationsMutation: state.notificationsMutation
    },
    actions: {
      submitNotifications: actions.submitNotifications
    }
  };
}
