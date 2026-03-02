export function useSettingsNotificationsLogic({
  notificationsForm,
  notificationsMessage,
  notificationsMessageType,
  notificationsMutation,
  settingsQueryKey,
  queryClient,
  toErrorMessage,
  handleAuthError,
  applySettingsData
}) {
  async function submitNotifications() {
    notificationsMessage.value = "";

    try {
      const data = await notificationsMutation.mutateAsync({
        productUpdates: notificationsForm.productUpdates,
        accountActivity: notificationsForm.accountActivity,
        securityAlerts: true
      });

      queryClient.setQueryData(settingsQueryKey, data);
      applySettingsData(data);
      notificationsMessageType.value = "success";
      notificationsMessage.value = "Notification settings updated.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      notificationsMessageType.value = "error";
      notificationsMessage.value = toErrorMessage(error, "Unable to update notifications.");
    }
  }

  return {
    submitNotifications
  };
}
