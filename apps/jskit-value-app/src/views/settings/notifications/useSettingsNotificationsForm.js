import { reactive, ref } from "vue";
import { useMutation } from "@tanstack/vue-query";
import { api } from "../../../services/api/index.js";
import { SETTINGS_QUERY_KEY } from "../lib/useSettingsPageConfig.js";
import { useSettingsContext } from "../lib/useSettingsContext.js";
import { useSettingsNotificationsLogic } from "./lib/useSettingsNotificationsLogic.js";

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
    mutationFn: (payload) => api.settings.updateNotifications(payload)
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
