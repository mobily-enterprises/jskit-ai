import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";

import { useSettingsNotificationsLogic } from "../../src/views/settings/notifications/lib/useSettingsNotificationsLogic.js";

describe("useSettingsNotificationsLogic", () => {
  it("submits notification settings successfully", async () => {
    const notificationsForm = {
      productUpdates: false,
      accountActivity: true,
      securityAlerts: false
    };
    const notificationsMessage = ref("existing");
    const notificationsMessageType = ref("error");
    const notificationsMutation = {
      mutateAsync: vi.fn(async () => ({
        notifications: {
          productUpdates: false,
          accountActivity: true,
          securityAlerts: true
        }
      }))
    };
    const queryClient = {
      setQueryData: vi.fn()
    };
    const applySettingsData = vi.fn();

    const vm = useSettingsNotificationsLogic({
      notificationsForm,
      notificationsMessage,
      notificationsMessageType,
      notificationsMutation,
      settingsQueryKey: ["settings"],
      queryClient,
      toErrorMessage: (error, fallback) => String(error?.message || fallback),
      handleAuthError: async () => false,
      applySettingsData
    });

    await vm.submitNotifications();

    expect(notificationsMutation.mutateAsync).toHaveBeenCalledWith({
      productUpdates: false,
      accountActivity: true,
      securityAlerts: true
    });
    expect(queryClient.setQueryData).toHaveBeenCalledWith(["settings"], {
      notifications: {
        productUpdates: false,
        accountActivity: true,
        securityAlerts: true
      }
    });
    expect(applySettingsData).toHaveBeenCalledTimes(1);
    expect(notificationsMessageType.value).toBe("success");
    expect(notificationsMessage.value).toBe("Notification settings updated.");
  });

  it("handles auth and generic errors", async () => {
    const notificationsMessage = ref("");
    const notificationsMessageType = ref("success");
    const notificationsMutation = {
      mutateAsync: vi.fn(async () => {
        throw new Error("bad request");
      })
    };

    const vmAuthHandled = useSettingsNotificationsLogic({
      notificationsForm: {
        productUpdates: true,
        accountActivity: true,
        securityAlerts: true
      },
      notificationsMessage,
      notificationsMessageType,
      notificationsMutation,
      settingsQueryKey: ["settings"],
      queryClient: {
        setQueryData: vi.fn()
      },
      toErrorMessage: (error, fallback) => String(error?.message || fallback),
      handleAuthError: async () => true,
      applySettingsData: vi.fn()
    });

    await vmAuthHandled.submitNotifications();
    expect(notificationsMessage.value).toBe("");

    const vmGenericError = useSettingsNotificationsLogic({
      notificationsForm: {
        productUpdates: true,
        accountActivity: true,
        securityAlerts: true
      },
      notificationsMessage,
      notificationsMessageType,
      notificationsMutation,
      settingsQueryKey: ["settings"],
      queryClient: {
        setQueryData: vi.fn()
      },
      toErrorMessage: (error, fallback) => String(error?.message || fallback),
      handleAuthError: async () => false,
      applySettingsData: vi.fn()
    });

    await vmGenericError.submitNotifications();

    expect(notificationsMessageType.value).toBe("error");
    expect(notificationsMessage.value).toBe("bad request");
  });
});
