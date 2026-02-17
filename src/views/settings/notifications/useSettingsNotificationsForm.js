import { reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig";
import { useSettingsContext } from "../lib/useSettingsContext";
import { useSettingsNotificationsLogic } from "./lib/useSettingsNotificationsLogic";

export function useSettingsNotificationsForm(options) {
  if (!options) {
    return useSettingsContext().sections.notifications;
  }

  const { queryClient, toErrorMessage, handleAuthError, applySettingsData } = options;

  const notificationsForm = reactive({
    productUpdates: true,
    accountActivity: true,
    securityAlerts: true
  });

  const notificationsMessage = ref("");
  const notificationsMessageType = ref("success");

  const notificationsMutation = useMutation({
    mutationFn: (payload) => api.updateNotificationSettings(payload)
  });

  const { submitNotifications } = useSettingsNotificationsLogic({
    notificationsForm,
    notificationsMessage,
    notificationsMessageType,
    notificationsMutation,
    settingsQueryKey: SETTINGS_QUERY_KEY,
    queryClient,
    toErrorMessage,
    handleAuthError,
    applySettingsData
  });

  function hydrate(data) {
    if (!data || typeof data !== "object") {
      return;
    }

    notificationsForm.productUpdates = Boolean(data.notifications?.productUpdates);
    notificationsForm.accountActivity = Boolean(data.notifications?.accountActivity);
    notificationsForm.securityAlerts = true;
  }

  return {
    state: reactive({
      notificationsForm,
      notificationsMessage,
      notificationsMessageType,
      notificationsMutation
    }),
    actions: {
      submitNotifications
    },
    hydrate
  };
}
