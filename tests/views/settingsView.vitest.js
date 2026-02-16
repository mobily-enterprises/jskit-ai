import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerSearch: { tab: "preferences" },
  themeName: { value: "light" },
  queryData: { value: null },
  queryError: { value: null },
  queryPending: { value: false },
  api: {
    settings: vi.fn(),
    updateProfileSettings: vi.fn(),
    updatePreferencesSettings: vi.fn(),
    updateNotificationSettings: vi.fn(),
    changePassword: vi.fn(),
    logoutOtherSessions: vi.fn()
  },
  authStore: {
    setSignedOut: vi.fn(),
    setUsername: vi.fn()
  },
  setQueryData: vi.fn()
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => {
    const state = {
      location: {
        search: mocks.routerSearch
      }
    };
    return {
      value: options?.select ? options.select(state) : state
    };
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: () => ({
    data: mocks.queryData,
    error: mocks.queryError,
    isPending: mocks.queryPending
  }),
  useMutation: ({ mutationFn }) => ({
    isPending: { value: false },
    mutateAsync: (payload) => mutationFn(payload)
  }),
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData
  })
}));

vi.mock("vuetify", () => ({
  useTheme: () => ({
    global: {
      name: mocks.themeName
    }
  })
}));

vi.mock("../../src/services/api.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

import SettingsView from "../../src/views/SettingsView.vue";

function buildSettingsPayload(overrides = {}) {
  return {
    profile: {
      displayName: "demo-user",
      email: "demo@example.com",
      emailManagedBy: "supabase",
      emailChangeFlow: "supabase"
    },
    security: {
      mfa: {
        status: "not_enabled",
        enrolled: false,
        methods: []
      },
      sessions: {
        canSignOutOtherDevices: true
      },
      password: {
        canChange: true
      }
    },
    preferences: {
      theme: "system",
      locale: "en-US",
      timeZone: "UTC",
      dateFormat: "system",
      numberFormat: "system",
      currencyCode: "USD",
      defaultMode: "fv",
      defaultTiming: "ordinary",
      defaultPaymentsPerYear: 12,
      defaultHistoryPageSize: 10
    },
    notifications: {
      productUpdates: true,
      accountActivity: true,
      securityAlerts: true
    },
    ...overrides
  };
}

function mountView() {
  return mount(SettingsView, {
    global: {
      stubs: {
        "v-main": true,
        "v-container": true,
        "v-card": true,
        "v-card-item": true,
        "v-card-title": true,
        "v-card-subtitle": true,
        "v-divider": true,
        "v-card-text": true,
        "v-alert": true,
        "v-tabs": true,
        "v-tab": true,
        "v-window": true,
        "v-window-item": true,
        "v-row": true,
        "v-col": true,
        "v-form": true,
        "v-text-field": true,
        "v-btn": true,
        "v-switch": true,
        "v-chip": true,
        "v-select": true
      }
    }
  });
}

describe("SettingsView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.routerSearch = { tab: "preferences" };
    mocks.themeName.value = "light";
    mocks.queryData.value = buildSettingsPayload();
    mocks.queryError.value = null;
    mocks.queryPending.value = false;
    mocks.api.settings.mockReset();
    mocks.api.updateProfileSettings.mockReset();
    mocks.api.updatePreferencesSettings.mockReset();
    mocks.api.updateNotificationSettings.mockReset();
    mocks.api.changePassword.mockReset();
    mocks.api.logoutOtherSessions.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.setUsername.mockReset();
    mocks.setQueryData.mockReset();
  });

  it("loads settings payload and hydrates forms", async () => {
    mocks.routerSearch = { tab: "profile" };
    const wrapper = mountView();
    await nextTick();

    expect(wrapper.vm.activeTab).toBe("profile");
    expect(wrapper.vm.profileForm.displayName).toBe("demo-user");
    expect(wrapper.vm.preferencesForm.currencyCode).toBe("USD");
    expect(wrapper.vm.notificationsForm.securityAlerts).toBe(true);
    expect(wrapper.vm.mfaLabel).toContain("not enabled");
  });

  it("handles invalid tab fallback and helper error branches", async () => {
    mocks.routerSearch = { tab: "not-a-tab" };
    mocks.queryData.value = null;
    mocks.queryError.value = {
      status: 500,
      message: "Load failed."
    };

    const wrapper = mountView();
    await nextTick();

    expect(wrapper.vm.activeTab).toBe("preferences");
    expect(wrapper.vm.resolveTabFromSearch({ tab: "security" }).toLowerCase()).toBe("security");
    expect(wrapper.vm.resolveTabFromSearch({ tab: "invalid-tab" })).toBe("preferences");

    expect(
      wrapper.vm.toErrorMessage(
        {
          fieldErrors: {
            locale: "Locale is invalid.",
            timeZone: "Time zone is invalid."
          }
        },
        "fallback"
      )
    ).toContain("Locale is invalid.");

    await expect(wrapper.vm.handleAuthError({ status: 500, message: "No auth" })).resolves.toBe(false);
    await expect(wrapper.vm.handleAuthError({ status: 401, message: "Auth required" })).resolves.toBe(true);
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("submits profile updates and updates username", async () => {
    const payload = buildSettingsPayload({
      profile: {
        displayName: "new-name",
        email: "demo@example.com",
        emailManagedBy: "supabase",
        emailChangeFlow: "supabase"
      }
    });
    mocks.api.updateProfileSettings.mockResolvedValue(payload);

    const wrapper = mountView();
    wrapper.vm.profileForm.displayName = "new-name";

    await wrapper.vm.submitProfile();

    expect(mocks.api.updateProfileSettings).toHaveBeenCalledWith({ displayName: "new-name" });
    expect(mocks.authStore.setUsername).toHaveBeenCalledWith("new-name");
    expect(wrapper.vm.profileMessageType).toBe("success");
  });

  it("submits preferences and surfaces field validation errors", async () => {
    mocks.api.updatePreferencesSettings.mockRejectedValue({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        timeZone: "Time zone must be a valid IANA time zone identifier."
      }
    });

    const wrapper = mountView();
    await wrapper.vm.submitPreferences();

    expect(mocks.api.updatePreferencesSettings).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.preferencesFieldErrors.timeZone).toContain("IANA time zone");
    expect(wrapper.vm.preferencesMessageType).toBe("error");
  });

  it("submits preferences successfully and applies theme preference", async () => {
    const payload = buildSettingsPayload({
      preferences: {
        theme: "dark",
        locale: "en-GB",
        timeZone: "Europe/London",
        dateFormat: "dmy",
        numberFormat: "dot-comma",
        currencyCode: "EUR",
        defaultMode: "pv",
        defaultTiming: "due",
        defaultPaymentsPerYear: 4,
        defaultHistoryPageSize: 25
      }
    });
    mocks.api.updatePreferencesSettings.mockResolvedValue(payload);

    const wrapper = mountView();
    await wrapper.vm.submitPreferences();

    expect(mocks.api.updatePreferencesSettings).toHaveBeenCalledTimes(1);
    expect(mocks.setQueryData).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.preferencesMessageType).toBe("success");
    expect(mocks.themeName.value).toBe("dark");
    expect(wrapper.vm.preferencesForm.defaultHistoryPageSize).toBe(25);
  });

  it("submits password change and clears password fields", async () => {
    mocks.api.changePassword.mockResolvedValue({ ok: true, message: "Password changed." });

    const wrapper = mountView();
    wrapper.vm.securityForm.currentPassword = "old-password";
    wrapper.vm.securityForm.newPassword = "new-password-123";
    wrapper.vm.securityForm.confirmPassword = "new-password-123";

    await wrapper.vm.submitPasswordChange();

    expect(mocks.api.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    expect(wrapper.vm.securityForm.currentPassword).toBe("");
    expect(wrapper.vm.securityMessageType).toBe("success");
  });

  it("handles password and notifications non-auth error branches", async () => {
    const wrapper = mountView();

    mocks.api.changePassword.mockRejectedValue({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        newPassword: "Password too weak."
      }
    });
    await wrapper.vm.submitPasswordChange();
    expect(wrapper.vm.securityFieldErrors.newPassword).toContain("weak");
    expect(wrapper.vm.securityMessageType).toBe("error");

    mocks.api.updateNotificationSettings.mockRejectedValue({
      status: 500,
      message: "Notification save failed."
    });
    await wrapper.vm.submitNotifications();
    expect(wrapper.vm.notificationsMessageType).toBe("error");
    expect(wrapper.vm.notificationsMessage).toContain("Notification save failed");
  });

  it("submits sign-out-others and handles auth failures", async () => {
    mocks.api.logoutOtherSessions.mockResolvedValue({
      ok: true,
      message: "Signed out from other active sessions."
    });

    const wrapper = mountView();
    await wrapper.vm.submitLogoutOthers();

    expect(wrapper.vm.sessionsMessageType).toBe("success");

    mocks.api.logoutOtherSessions.mockRejectedValue({ status: 401, message: "Authentication required." });
    await wrapper.vm.submitLogoutOthers();

    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("covers system theme resolution and logout-others generic error", async () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = matchMediaMock;

    try {
      const wrapper = mountView();
      wrapper.vm.applyThemePreference("system");
      expect(mocks.themeName.value).toBe("dark");

      mocks.api.logoutOtherSessions.mockRejectedValue({
        status: 500,
        message: "Unable to revoke sessions."
      });
      await wrapper.vm.submitLogoutOthers();
      expect(wrapper.vm.sessionsMessageType).toBe("error");
      expect(wrapper.vm.sessionsMessage).toContain("Unable to revoke sessions");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
