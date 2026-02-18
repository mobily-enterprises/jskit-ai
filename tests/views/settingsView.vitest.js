import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  routerPathname: "/account/settings",
  routerSearch: { section: "preferences" },
  themeName: { value: "light" },
  queryData: { value: null },
  queryError: { value: null },
  queryPending: { value: false },
  api: {
    settings: {
      get: vi.fn(),
      updateProfile: vi.fn(),
      deleteAvatar: vi.fn(),
      updatePreferences: vi.fn(),
      updateNotifications: vi.fn(),
      changePassword: vi.fn(),
      setPasswordMethodEnabled: vi.fn(),
      logoutOtherSessions: vi.fn()
    }
  },
  authStore: {
    setSignedOut: vi.fn(),
    setUsername: vi.fn()
  },
  workspaceStore: {
    clearWorkspaceState: vi.fn(),
    applyBootstrap: vi.fn(),
    applyProfile: vi.fn()
  },
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn()
}));

vi.mock("@tanstack/vue-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: (options) => {
    const state = {
      location: {
        search: mocks.routerSearch,
        pathname: mocks.routerPathname
      }
    };
    return {
      value: options?.select ? options.select(state) : state
    };
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQuery: (options = {}) => {
    const enabled =
      options.enabled && typeof options.enabled === "object" && "value" in options.enabled
        ? Boolean(options.enabled.value)
        : Boolean(options.enabled ?? true);
    if (enabled && typeof options.queryFn === "function") {
      void options.queryFn();
    }

    return {
      data: mocks.queryData,
      error: mocks.queryError,
      isPending: mocks.queryPending
    };
  },
  useMutation: ({ mutationFn }) => ({
    isPending: { value: false },
    mutateAsync: (payload) => mutationFn(payload)
  }),
  useQueryClient: () => ({
    setQueryData: mocks.setQueryData,
    invalidateQueries: mocks.invalidateQueries
  })
}));

vi.mock("vuetify", () => ({
  useTheme: () => ({
    global: {
      name: mocks.themeName
    }
  })
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/stores/authStore.js", () => ({
  useAuthStore: () => mocks.authStore
}));

vi.mock("../../src/stores/workspaceStore.js", () => ({
  useWorkspaceStore: () => mocks.workspaceStore
}));

import SettingsView from "../../src/views/settings/SettingsView.vue";

function buildSettingsPayload(overrides = {}) {
  return {
    profile: {
      displayName: "demo-user",
      email: "demo@example.com",
      emailManagedBy: "supabase",
      emailChangeFlow: "supabase",
      avatar: {
        uploadedUrl: null,
        gravatarUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
        effectiveUrl: "https://www.gravatar.com/avatar/hash?d=mp&s=64",
        hasUploadedAvatar: false,
        size: 64,
        version: null
      }
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
      authPolicy: {
        minimumEnabledMethods: 1,
        enabledMethodsCount: 2
      },
      authMethods: [
        {
          id: "password",
          kind: "password",
          provider: "email",
          label: "Password",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: true,
          supportsSecretUpdate: true,
          requiresCurrentPassword: true
        },
        {
          id: "email_otp",
          kind: "otp",
          provider: "email",
          label: "Email one-time code",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: false,
          supportsSecretUpdate: false,
          requiresCurrentPassword: false
        }
      ]
    },
    preferences: {
      theme: "system",
      locale: "en-US",
      timeZone: "UTC",
      dateFormat: "system",
      numberFormat: "system",
      currencyCode: "USD",
      avatarSize: 64
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
        "v-list": true,
        "v-list-item": true,
        "v-window": true,
        "v-window-item": true,
        "v-row": true,
        "v-col": true,
        "v-form": true,
        "v-text-field": true,
        "v-btn": true,
        "v-switch": true,
        "v-chip": true,
        "v-select": true,
        "v-avatar": true,
        "v-img": true,
        "v-dialog": true,
        "v-card-actions": true,
        "v-spacer": true
      }
    }
  });
}

function vmSections(wrapper) {
  return wrapper.vm.sections;
}

function vmPage(wrapper) {
  return wrapper.vm.page;
}

describe("SettingsView", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.routerPathname = "/account/settings";
    mocks.routerSearch = { section: "preferences" };
    mocks.themeName.value = "light";
    mocks.queryData.value = buildSettingsPayload();
    mocks.queryError.value = null;
    mocks.queryPending.value = false;
    mocks.api.settings.get.mockReset();
    mocks.api.settings.updateProfile.mockReset();
    mocks.api.settings.deleteAvatar.mockReset();
    mocks.api.settings.updatePreferences.mockReset();
    mocks.api.settings.updateNotifications.mockReset();
    mocks.api.settings.changePassword.mockReset();
    mocks.api.settings.setPasswordMethodEnabled.mockReset();
    mocks.api.settings.logoutOtherSessions.mockReset();
    mocks.authStore.setSignedOut.mockReset();
    mocks.authStore.setUsername.mockReset();
    mocks.workspaceStore.clearWorkspaceState.mockReset();
    mocks.workspaceStore.applyBootstrap.mockReset();
    mocks.workspaceStore.applyProfile.mockReset();
    mocks.setQueryData.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  it("loads settings payload and hydrates forms", async () => {
    mocks.routerSearch = { section: "profile" };
    const wrapper = mountView();
    await nextTick();
    const page = vmPage(wrapper);
    const sections = vmSections(wrapper);

    expect(page.state.activeTab).toBe("profile");
    expect(sections.profile.state.profileForm.displayName).toBe("demo-user");
    expect(sections.preferences.state.preferencesForm.currencyCode).toBe("USD");
    expect(sections.notifications.state.notificationsForm.securityAlerts).toBe(true);
    expect(sections.security.state.mfaLabel).toContain("not enabled");
    wrapper.unmount();
  });

  it("handles invalid tab fallback and helper error branches", async () => {
    mocks.routerSearch = { section: "not-a-tab" };
    mocks.queryData.value = null;
    mocks.queryError.value = {
      status: 500,
      message: "Load failed."
    };

    const wrapper = mountView();
    await nextTick();
    const page = vmPage(wrapper);

    expect(page.state.activeTab).toBe("profile");
    expect(page.actions.resolveTabFromSearch({ section: "security" }).toLowerCase()).toBe("security");
    expect(page.actions.resolveTabFromSearch({ section: "invalid-tab" })).toBe("profile");

    expect(
      page.actions.toErrorMessage(
        {
          fieldErrors: {
            locale: "Locale is invalid.",
            timeZone: "Time zone is invalid."
          }
        },
        "fallback"
      )
    ).toContain("Locale is invalid.");

    await expect(page.actions.handleAuthError({ status: 500, message: "No auth" })).resolves.toBe(false);
    await expect(page.actions.handleAuthError({ status: 401, message: "Auth required" })).resolves.toBe(true);
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
    mocks.api.settings.updateProfile.mockResolvedValue(payload);

    const wrapper = mountView();
    const profile = vmSections(wrapper).profile;
    profile.state.profileForm.displayName = "new-name";

    await profile.actions.submitProfile();

    expect(mocks.api.settings.updateProfile).toHaveBeenCalledWith({ displayName: "new-name" });
    expect(mocks.authStore.setUsername).toHaveBeenCalledWith("new-name");
    expect(profile.state.profileMessageType).toBe("success");
  });

  it("submits preferences and surfaces field validation errors", async () => {
    mocks.api.settings.updatePreferences.mockRejectedValue({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        timeZone: "Time zone must be a valid IANA time zone identifier."
      }
    });

    const wrapper = mountView();
    const preferences = vmSections(wrapper).preferences;
    await preferences.actions.submitPreferences();

    expect(mocks.api.settings.updatePreferences).toHaveBeenCalledTimes(1);
    expect(preferences.state.preferencesFieldErrors.timeZone).toContain("IANA time zone");
    expect(preferences.state.preferencesMessageType).toBe("error");
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
        avatarSize: 96
      }
    });
    mocks.api.settings.updatePreferences.mockResolvedValue(payload);

    const wrapper = mountView();
    const preferences = vmSections(wrapper).preferences;
    await preferences.actions.submitPreferences();

    expect(mocks.api.settings.updatePreferences).toHaveBeenCalledTimes(1);
    expect(mocks.setQueryData).toHaveBeenCalledTimes(1);
    expect(preferences.state.preferencesMessageType).toBe("success");
    expect(mocks.themeName.value).toBe("dark");
    expect(preferences.state.preferencesForm.avatarSize).toBe(96);
  });

  it("submits password change and clears password fields", async () => {
    mocks.api.settings.changePassword.mockResolvedValue({ ok: true, message: "Password changed." });

    const wrapper = mountView();
    const security = vmSections(wrapper).security;
    security.state.securityForm.currentPassword = "old-password";
    security.state.securityForm.newPassword = "new-password-123";
    security.state.securityForm.confirmPassword = "new-password-123";

    await security.actions.submitPasswordChange();

    expect(mocks.api.settings.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    expect(security.state.securityForm.currentPassword).toBe("");
    expect(security.state.securityMessageType).toBe("success");
  });

  it("runs password setup + enable flow from disabled password method", async () => {
    const disabledPasswordPayload = buildSettingsPayload({
      security: {
        mfa: {
          status: "not_enabled",
          enrolled: false,
          methods: []
        },
        sessions: {
          canSignOutOtherDevices: true
        },
        authPolicy: {
          minimumEnabledMethods: 1,
          enabledMethodsCount: 1
        },
        authMethods: [
          {
            id: "password",
            kind: "password",
            provider: "email",
            label: "Password",
            configured: true,
            enabled: false,
            canEnable: true,
            canDisable: false,
            supportsSecretUpdate: true,
            requiresCurrentPassword: false
          },
          {
            id: "email_otp",
            kind: "otp",
            provider: "email",
            label: "Email one-time code",
            configured: true,
            enabled: true,
            canEnable: false,
            canDisable: false,
            supportsSecretUpdate: false,
            requiresCurrentPassword: false
          }
        ]
      }
    });
    const enabledPasswordPayload = buildSettingsPayload();
    mocks.queryData.value = disabledPasswordPayload;
    mocks.api.settings.changePassword.mockResolvedValue({ ok: true, message: "Password set." });
    mocks.api.settings.setPasswordMethodEnabled.mockResolvedValue(enabledPasswordPayload);

    const wrapper = mountView();
    const security = vmSections(wrapper).security;
    security.actions.openPasswordEnableSetup();
    security.state.securityForm.currentPassword = "will-be-ignored";
    security.state.securityForm.newPassword = "new-password-123";
    security.state.securityForm.confirmPassword = "new-password-123";

    await security.actions.submitPasswordChange();

    expect(security.state.isPasswordEnableSetupMode).toBe(false);
    expect(mocks.api.settings.changePassword).toHaveBeenCalledWith({
      currentPassword: undefined,
      newPassword: "new-password-123",
      confirmPassword: "new-password-123"
    });
    expect(mocks.api.settings.setPasswordMethodEnabled).toHaveBeenCalledWith({
      enabled: true
    });
    expect(security.state.providerMessageType).toBe("success");
    expect(security.state.providerMessage).toContain("enabled");
  });

  it("handles password and notifications non-auth error branches", async () => {
    const wrapper = mountView();
    const sections = vmSections(wrapper);

    mocks.api.settings.changePassword.mockRejectedValue({
      status: 400,
      message: "Validation failed.",
      fieldErrors: {
        newPassword: "Password too weak."
      }
    });
    await sections.security.actions.submitPasswordChange();
    expect(sections.security.state.securityFieldErrors.newPassword).toContain("weak");
    expect(sections.security.state.securityMessageType).toBe("error");

    mocks.api.settings.updateNotifications.mockRejectedValue({
      status: 500,
      message: "Notification save failed."
    });
    await sections.notifications.actions.submitNotifications();
    expect(sections.notifications.state.notificationsMessageType).toBe("error");
    expect(sections.notifications.state.notificationsMessage).toContain("Notification save failed");
  });

  it("submits sign-out-others and handles auth failures", async () => {
    mocks.api.settings.logoutOtherSessions.mockResolvedValue({
      ok: true,
      message: "Signed out from other active sessions."
    });

    const wrapper = mountView();
    const security = vmSections(wrapper).security;
    await security.actions.submitLogoutOthers();

    expect(security.state.sessionsMessageType).toBe("success");

    mocks.api.settings.logoutOtherSessions.mockRejectedValue({ status: 401, message: "Authentication required." });
    await security.actions.submitLogoutOthers();

    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("handles avatar editor unavailable branch", async () => {
    const wrapper = mountView();
    const profile = vmSections(wrapper).profile;
    await profile.actions.openAvatarEditor();
    expect(profile.state.avatarMessageType).toBe("error");
    expect(profile.state.avatarMessage).toContain("unavailable");
  });

  it("handles avatar delete success and auth failure", async () => {
    mocks.api.settings.deleteAvatar.mockResolvedValue(buildSettingsPayload());
    const wrapper = mountView();
    const profile = vmSections(wrapper).profile;

    await profile.actions.submitAvatarDelete();
    expect(mocks.api.settings.deleteAvatar).toHaveBeenCalledTimes(1);
    expect(profile.state.avatarMessageType).toBe("success");

    mocks.api.settings.deleteAvatar.mockRejectedValue({ status: 401, message: "Authentication required." });
    await profile.actions.submitAvatarDelete();
    expect(mocks.authStore.setSignedOut).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login", replace: true });
  });

  it("covers system theme resolution and logout-others generic error", async () => {
    const matchMediaMock = vi.fn().mockReturnValue({ matches: true });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = matchMediaMock;

    try {
      const wrapper = mountView();
      const sections = vmSections(wrapper);
      sections.preferences.actions.applyThemePreference("system");
      expect(mocks.themeName.value).toBe("dark");

      mocks.api.settings.logoutOtherSessions.mockRejectedValue({
        status: 500,
        message: "Unable to revoke sessions."
      });
      await sections.security.actions.submitLogoutOthers();
      expect(sections.security.state.sessionsMessageType).toBe("error");
      expect(sections.security.state.sessionsMessage).toContain("Unable to revoke sessions");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("maps settings query auth errors and clears load errors after recovery", async () => {
    mocks.queryData.value = null;
    mocks.queryError.value = null;

    const wrapper = mountView();
    await nextTick();

    mocks.queryError.value = {
      status: 401,
      message: "Authentication required."
    };
    await nextTick();

    mocks.queryError.value = null;
    await nextTick();
    expect(vmPage(wrapper).state.loadError).toBe("");
  });
});
