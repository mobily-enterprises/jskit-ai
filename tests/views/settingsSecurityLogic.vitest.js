import { reactive, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_PASSWORD_ID,
  buildOAuthMethodId
} from "../../shared/auth/authMethods.js";

const mocks = vi.hoisted(() => ({
  api: {
    settings: {
      oauthLinkStartUrl: vi.fn(
        (provider, { returnTo }) => `/api/settings/oauth/${provider}/start?returnTo=${returnTo}`
      )
    }
  },
  writePendingOAuthContext: vi.fn()
}));

vi.mock("../../src/services/api/index.js", () => ({
  api: mocks.api
}));

vi.mock("../../src/utils/oauthCallback.js", () => ({
  writePendingOAuthContext: mocks.writePendingOAuthContext
}));

import { useSettingsSecurityLogic } from "../../src/views/settings/security/lib/useSettingsSecurityLogic.js";

const PASSWORD_FORM_MODE_MANAGE = "manage";
const PASSWORD_FORM_MODE_ENABLE = "enable";

function buildSecurityPayload(overrides = {}) {
  return {
    security: {
      mfa: { status: "not_enabled" },
      authPolicy: {
        minimumEnabledMethods: 1,
        enabledMethodsCount: 1
      },
      authMethods: [
        {
          id: AUTH_METHOD_PASSWORD_ID,
          kind: AUTH_METHOD_KIND_PASSWORD,
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
          kind: AUTH_METHOD_KIND_OTP,
          provider: "email",
          label: "Email one-time code",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: false,
          supportsSecretUpdate: false,
          requiresCurrentPassword: false
        },
        {
          id: buildOAuthMethodId("google"),
          kind: AUTH_METHOD_KIND_OAUTH,
          provider: "google",
          label: "Google",
          configured: true,
          enabled: true,
          canEnable: false,
          canDisable: true,
          supportsSecretUpdate: false,
          requiresCurrentPassword: false
        }
      ]
    },
    ...overrides
  };
}

function createHarness({ securityData = buildSecurityPayload(), mode = PASSWORD_FORM_MODE_MANAGE } = {}) {
  const settingsQuery = {
    data: ref(securityData)
  };

  const passwordFormMode = ref(mode);
  const showPasswordForm = ref(false);
  const securityForm = reactive({
    currentPassword: "old-pass",
    newPassword: "new-pass-123",
    confirmPassword: "new-pass-123"
  });
  const showCurrentPassword = ref(true);
  const showNewPassword = ref(true);
  const showConfirmPassword = ref(true);
  const securityFieldErrors = reactive({
    currentPassword: "x",
    newPassword: "y",
    confirmPassword: "z"
  });
  const securityMessage = ref("");
  const securityMessageType = ref("success");
  const providerMessage = ref("");
  const providerMessageType = ref("success");
  const providerLinkStartInFlight = ref(false);
  const methodActionLoadingId = ref("");
  const sessionsMessage = ref("");
  const sessionsMessageType = ref("success");

  const passwordMutation = {
    isPending: ref(false),
    mutateAsync: vi.fn()
  };
  const setPasswordMethodEnabledMutation = {
    isPending: ref(false),
    mutateAsync: vi.fn()
  };
  const logoutOthersMutation = {
    isPending: ref(false),
    mutateAsync: vi.fn()
  };
  const unlinkProviderMutation = {
    isPending: ref(false),
    mutateAsync: vi.fn()
  };

  const queryClient = {
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(async () => undefined)
  };

  const clearFieldErrors = vi.fn((fieldErrors) => {
    for (const key of Object.keys(fieldErrors)) {
      fieldErrors[key] = "";
    }
  });
  const toErrorMessage = vi.fn((error, fallback) => String(error?.message || fallback));
  const handleAuthError = vi.fn(async () => false);
  const buildSettingsPathWithTab = vi.fn((tab) => `/account/settings?section=${tab}`);

  const logic = useSettingsSecurityLogic({
    settingsQuery,
    passwordFormMode,
    showPasswordForm,
    securityForm,
    showCurrentPassword,
    showNewPassword,
    showConfirmPassword,
    securityFieldErrors,
    securityMessage,
    securityMessageType,
    providerMessage,
    providerMessageType,
    providerLinkStartInFlight,
    methodActionLoadingId,
    passwordMutation,
    setPasswordMethodEnabledMutation,
    logoutOthersMutation,
    unlinkProviderMutation,
    sessionsMessage,
    sessionsMessageType,
    queryClient,
    settingsQueryKey: ["settings"],
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    buildSettingsPathWithTab,
    PASSWORD_FORM_MODE_MANAGE,
    PASSWORD_FORM_MODE_ENABLE
  });

  return {
    settingsQuery,
    passwordFormMode,
    showPasswordForm,
    securityForm,
    showCurrentPassword,
    showNewPassword,
    showConfirmPassword,
    securityFieldErrors,
    securityMessage,
    securityMessageType,
    providerMessage,
    providerMessageType,
    providerLinkStartInFlight,
    methodActionLoadingId,
    sessionsMessage,
    sessionsMessageType,
    passwordMutation,
    setPasswordMethodEnabledMutation,
    logoutOthersMutation,
    unlinkProviderMutation,
    queryClient,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    buildSettingsPathWithTab,
    logic
  };
}

describe("useSettingsSecurityLogic", () => {
  beforeEach(() => {
    mocks.api.settings.oauthLinkStartUrl.mockReset();
    mocks.api.settings.oauthLinkStartUrl.mockImplementation(
      (provider, { returnTo }) => `/api/settings/oauth/${provider}/start?returnTo=${returnTo}`
    );
    mocks.writePendingOAuthContext.mockReset();
  });

  it("builds auth method data, policy, hints, and labels", () => {
    const harness = createHarness();
    const { logic } = harness;

    expect(logic.mfaStatus.value).toBe("not_enabled");
    expect(logic.mfaLabel.value).toBe("MFA not enabled");
    expect(logic.mfaChipColor.value).toBe("secondary");
    expect(logic.securityAuthPolicy.value).toEqual({
      minimumEnabledMethods: 1,
      enabledMethodsCount: 1
    });
    expect(logic.securityMethodsHint.value).toBe("At least one sign-in method must remain enabled.");
    expect(logic.authMethodItems.value.some((method) => method.kind === AUTH_METHOD_KIND_OTP)).toBe(false);

    harness.settingsQuery.data.value = buildSecurityPayload({
      security: {
        mfa: { status: "enabled" },
        authPolicy: {
          minimumEnabledMethods: "2",
          enabledMethodsCount: "3"
        },
        authMethods: [
          {
            id: buildOAuthMethodId("google"),
            kind: AUTH_METHOD_KIND_OAUTH,
            provider: "google",
            label: "Google",
            configured: true,
            enabled: false,
            canEnable: true,
            canDisable: true
          }
        ]
      }
    });

    expect(logic.mfaLabel.value).toBe("MFA enabled");
    expect(logic.mfaChipColor.value).toBe("primary");
    expect(logic.securityAuthPolicy.value).toEqual({
      minimumEnabledMethods: 2,
      enabledMethodsCount: 3
    });
    expect(logic.securityMethodsHint.value).toContain("At least 2");
  });

  it("falls back to default auth methods and fallback password method", () => {
    const harness = createHarness({
      securityData: {
        security: {
          mfa: { status: "not_enabled" },
          authPolicy: null,
          authMethods: []
        }
      }
    });

    expect(harness.logic.securityAuthMethods.value.length).toBeGreaterThanOrEqual(2);
    expect(harness.logic.passwordMethod.value.id).toBe(AUTH_METHOD_PASSWORD_ID);

    harness.settingsQuery.data.value = {
      security: {
        authMethods: [{ id: "", kind: "password" }]
      }
    };
    expect(harness.logic.passwordMethod.value.id).toBe(AUTH_METHOD_PASSWORD_ID);
  });

  it("normalizes methods and resolves method/provider status text", () => {
    const harness = createHarness();
    const { logic } = harness;

    expect(logic.normalizeAuthMethod(null)).toEqual({
      id: "",
      kind: "",
      provider: null,
      label: "Method",
      configured: false,
      enabled: false,
      canEnable: false,
      canDisable: false,
      supportsSecretUpdate: false,
      requiresCurrentPassword: false
    });
    expect(logic.authMethodStatusText({ kind: AUTH_METHOD_KIND_OTP })).toBe("Always available");
    expect(logic.authMethodStatusText({ kind: AUTH_METHOD_KIND_OAUTH, enabled: true })).toBe("Linked");
    expect(logic.authMethodStatusText({ kind: AUTH_METHOD_KIND_OAUTH, enabled: false })).toBe("Not linked");
    expect(logic.authMethodStatusText({ kind: AUTH_METHOD_KIND_PASSWORD, enabled: true })).toBe("Enabled");
    expect(logic.authMethodStatusText({ configured: true, enabled: false })).toBe("Configured but disabled");
    expect(logic.authMethodStatusText({ configured: false, enabled: false })).toBe("Not configured");

    expect(logic.providerLabel("google")).toBe("Google");
    expect(logic.providerLabel("custom-provider")).toBe("custom-provider");
  });

  it("opens and closes password form in manage mode", () => {
    const harness = createHarness();
    const { logic } = harness;

    logic.openPasswordForm();
    expect(harness.showPasswordForm.value).toBe(true);
    expect(harness.passwordFormMode.value).toBe(PASSWORD_FORM_MODE_MANAGE);
    expect(harness.securityForm.currentPassword).toBe("");
    expect(harness.showCurrentPassword.value).toBe(false);
    expect(harness.securityMessage.value).toBe("");

    harness.securityForm.currentPassword = "x";
    harness.securityForm.newPassword = "y";
    harness.securityForm.confirmPassword = "z";
    harness.showCurrentPassword.value = true;
    harness.showNewPassword.value = true;
    harness.showConfirmPassword.value = true;

    logic.closePasswordForm();
    expect(harness.showPasswordForm.value).toBe(false);
    expect(harness.securityForm.currentPassword).toBe("");
    expect(harness.securityForm.newPassword).toBe("");
    expect(harness.securityForm.confirmPassword).toBe("");
    expect(harness.showCurrentPassword.value).toBe(false);
    expect(harness.showNewPassword.value).toBe(false);
    expect(harness.showConfirmPassword.value).toBe(false);
  });

  it("blocks password form open when password method cannot be managed", () => {
    const harness = createHarness({
      securityData: buildSecurityPayload({
        security: {
          mfa: { status: "not_enabled" },
          authPolicy: { minimumEnabledMethods: 1, enabledMethodsCount: 1 },
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
              provider: "email",
              configured: true,
              enabled: false,
              canEnable: true,
              canDisable: false,
              requiresCurrentPassword: false
            }
          ]
        }
      })
    });

    harness.logic.openPasswordForm();
    expect(harness.showPasswordForm.value).toBe(false);
    expect(harness.securityMessageType.value).toBe("error");
    expect(harness.securityMessage.value).toContain("Enable password sign-in");
  });

  it("opens password enable setup when allowed and blocks when not allowed", () => {
    const blockedHarness = createHarness();
    blockedHarness.logic.openPasswordEnableSetup();
    expect(blockedHarness.showPasswordForm.value).toBe(false);
    expect(blockedHarness.providerMessageType.value).toBe("error");

    const enabledHarness = createHarness({
      securityData: buildSecurityPayload({
        security: {
          mfa: { status: "not_enabled" },
          authPolicy: { minimumEnabledMethods: 1, enabledMethodsCount: 1 },
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
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
              kind: AUTH_METHOD_KIND_OTP,
              provider: "email",
              label: "Email one-time code",
              configured: true,
              enabled: true
            }
          ]
        }
      })
    });

    enabledHarness.logic.openPasswordEnableSetup();
    expect(enabledHarness.showPasswordForm.value).toBe(true);
    expect(enabledHarness.passwordFormMode.value).toBe(PASSWORD_FORM_MODE_ENABLE);
    expect(enabledHarness.securityMessage.value).toBe("");
  });

  it("prevents password submission when password form is not currently submit-able", async () => {
    const harness = createHarness({
      mode: PASSWORD_FORM_MODE_ENABLE,
      securityData: buildSecurityPayload({
        security: {
          authPolicy: { minimumEnabledMethods: 1, enabledMethodsCount: 1 },
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
              configured: false,
              enabled: false,
              canEnable: false
            }
          ]
        }
      })
    });

    await harness.logic.submitPasswordChange();

    expect(harness.passwordMutation.mutateAsync).not.toHaveBeenCalled();
    expect(harness.securityMessageType.value).toBe("error");
    expect(harness.securityMessage.value).toContain("cannot be enabled");
  });

  it("submits password update in manage mode and invalidates settings query", async () => {
    const harness = createHarness();
    harness.showPasswordForm.value = true;
    harness.passwordMutation.mutateAsync.mockResolvedValue({
      message: "Password updated."
    });

    await harness.logic.submitPasswordChange();

    expect(harness.passwordMutation.mutateAsync).toHaveBeenCalledWith({
      currentPassword: "old-pass",
      newPassword: "new-pass-123",
      confirmPassword: "new-pass-123"
    });
    expect(harness.setPasswordMethodEnabledMutation.mutateAsync).not.toHaveBeenCalled();
    expect(harness.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["settings"] });
    expect(harness.securityMessageType.value).toBe("success");
    expect(harness.securityMessage.value).toBe("");
    expect(harness.showPasswordForm.value).toBe(false);
  });

  it("submits enable-after-setup flow and updates query cache", async () => {
    const harness = createHarness({
      mode: PASSWORD_FORM_MODE_ENABLE,
      securityData: buildSecurityPayload({
        security: {
          authPolicy: { minimumEnabledMethods: 1, enabledMethodsCount: 1 },
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
              configured: true,
              enabled: false,
              canEnable: true,
              canDisable: false,
              supportsSecretUpdate: true,
              requiresCurrentPassword: false
            },
            {
              id: "email_otp",
              kind: AUTH_METHOD_KIND_OTP,
              configured: true,
              enabled: true
            }
          ]
        }
      })
    });
    harness.passwordMutation.mutateAsync.mockResolvedValue({ ok: true });
    harness.setPasswordMethodEnabledMutation.mutateAsync.mockResolvedValue({ security: { authMethods: [] } });

    await harness.logic.submitPasswordChange();

    expect(harness.passwordMutation.mutateAsync).toHaveBeenCalledWith({
      currentPassword: undefined,
      newPassword: "new-pass-123",
      confirmPassword: "new-pass-123"
    });
    expect(harness.setPasswordMethodEnabledMutation.mutateAsync).toHaveBeenCalledWith({ enabled: true });
    expect(harness.queryClient.setQueryData).toHaveBeenCalledWith(["settings"], { security: { authMethods: [] } });
    expect(harness.providerMessageType.value).toBe("success");
    expect(harness.providerMessage.value).toContain("enabled");
    expect(harness.methodActionLoadingId.value).toBe("");
  });

  it("handles password submission errors, field errors, and auth short-circuit", async () => {
    const harness = createHarness();
    harness.passwordMutation.mutateAsync.mockRejectedValue({
      message: "Unable to update password.",
      fieldErrors: {
        currentPassword: "Current password is invalid.",
        newPassword: "Password too weak."
      }
    });

    await harness.logic.submitPasswordChange();

    expect(harness.securityFieldErrors.currentPassword).toContain("invalid");
    expect(harness.securityFieldErrors.newPassword).toContain("weak");
    expect(harness.securityMessageType.value).toBe("error");
    expect(harness.toErrorMessage).toHaveBeenCalledWith(expect.any(Object), "Unable to update password.");

    const authHarness = createHarness({
      mode: PASSWORD_FORM_MODE_ENABLE,
      securityData: buildSecurityPayload({
        security: {
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
              configured: true,
              enabled: false,
              canEnable: true,
              requiresCurrentPassword: false
            },
            {
              id: "email_otp",
              kind: AUTH_METHOD_KIND_OTP,
              configured: true,
              enabled: true
            }
          ]
        }
      })
    });
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.passwordMutation.mutateAsync.mockRejectedValue(new Error("auth"));

    await authHarness.logic.submitPasswordChange();

    expect(authHarness.handleAuthError).toHaveBeenCalled();
    expect(authHarness.securityMessage.value).toBe("");
    expect(authHarness.methodActionLoadingId.value).toBe("");
  });

  it("toggles password method and handles errors", async () => {
    const harness = createHarness();
    harness.setPasswordMethodEnabledMutation.mutateAsync.mockResolvedValue({ security: { authMethods: [] } });
    await harness.logic.submitPasswordMethodToggle(false);
    expect(harness.queryClient.setQueryData).toHaveBeenCalled();
    expect(harness.providerMessageType.value).toBe("success");
    expect(harness.providerMessage.value).toContain("disabled");

    harness.setPasswordMethodEnabledMutation.mutateAsync.mockRejectedValue(new Error("toggle failed"));
    await harness.logic.submitPasswordMethodToggle(true);
    expect(harness.providerMessageType.value).toBe("error");
    expect(harness.providerMessage.value).toContain("toggle failed");

    const authHarness = createHarness();
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.setPasswordMethodEnabledMutation.mutateAsync.mockRejectedValue(new Error("unauthorized"));
    await authHarness.logic.submitPasswordMethodToggle(true);
    expect(authHarness.handleAuthError).toHaveBeenCalled();
    expect(authHarness.methodActionLoadingId.value).toBe("");
  });

  it("starts provider link and handles invalid provider and non-browser mode", async () => {
    const harness = createHarness();
    await harness.logic.startProviderLink("unsupported");
    expect(harness.providerMessageType.value).toBe("error");
    expect(harness.providerMessage.value).toContain("not supported");

    const originalWindow = globalThis.window;
    vi.stubGlobal("window", undefined);
    try {
      await harness.logic.startProviderLink("google");
      expect(mocks.writePendingOAuthContext).toHaveBeenCalledWith({
        provider: "google",
        intent: "link",
        returnTo: "/account/settings?section=security"
      });
      expect(harness.providerLinkStartInFlight.value).toBe(false);
    } finally {
      vi.stubGlobal("window", originalWindow);
    }
  });

  it("starts provider link and redirects in browser", async () => {
    const harness = createHarness();
    const assign = vi.fn();
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, assign };

    try {
      await harness.logic.startProviderLink("google");
      expect(mocks.api.settings.oauthLinkStartUrl).toHaveBeenCalledWith("google", {
        returnTo: "/account/settings?section=security"
      });
      expect(assign).toHaveBeenCalledWith(
        "/api/settings/oauth/google/start?returnTo=/account/settings?section=security"
      );
      expect(harness.providerLinkStartInFlight.value).toBe(true);
    } finally {
      window.location = originalLocation;
    }
  });

  it("unlinks provider and handles invalid/auth/error paths", async () => {
    const harness = createHarness();
    await harness.logic.submitProviderUnlink("unsupported");
    expect(harness.providerMessageType.value).toBe("error");

    harness.unlinkProviderMutation.mutateAsync.mockResolvedValue({ security: { authMethods: [] } });
    await harness.logic.submitProviderUnlink("google");
    expect(harness.queryClient.setQueryData).toHaveBeenCalledWith(["settings"], { security: { authMethods: [] } });
    expect(harness.providerMessageType.value).toBe("success");
    expect(harness.providerMessage.value).toContain("Google unlinked");

    harness.unlinkProviderMutation.mutateAsync.mockRejectedValue(new Error("unlink failed"));
    await harness.logic.submitProviderUnlink("google");
    expect(harness.providerMessageType.value).toBe("error");
    expect(harness.providerMessage.value).toContain("unlink failed");

    const authHarness = createHarness();
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.unlinkProviderMutation.mutateAsync.mockRejectedValue(new Error("auth"));
    await authHarness.logic.submitProviderUnlink("google");
    expect(authHarness.handleAuthError).toHaveBeenCalled();
    expect(authHarness.methodActionLoadingId.value).toBe("");
  });

  it("submits logout-other-sessions flow and handles error branches", async () => {
    const harness = createHarness();
    harness.logoutOthersMutation.mutateAsync.mockResolvedValue({
      message: "Signed out from other active sessions."
    });
    await harness.logic.submitLogoutOthers();
    expect(harness.sessionsMessageType.value).toBe("success");
    expect(harness.sessionsMessage.value).toContain("Signed out");

    harness.logoutOthersMutation.mutateAsync.mockRejectedValue(new Error("logout failed"));
    await harness.logic.submitLogoutOthers();
    expect(harness.sessionsMessageType.value).toBe("error");
    expect(harness.sessionsMessage.value).toContain("logout failed");

    const authHarness = createHarness();
    authHarness.handleAuthError.mockResolvedValue(true);
    authHarness.logoutOthersMutation.mutateAsync.mockRejectedValue(new Error("auth"));
    await authHarness.logic.submitLogoutOthers();
    expect(authHarness.handleAuthError).toHaveBeenCalled();
  });

  it("exposes submit-pending computed from both password mutations", () => {
    const harness = createHarness();
    expect(harness.logic.passwordFormSubmitPending.value).toBe(false);
    harness.passwordMutation.isPending.value = true;
    expect(harness.logic.passwordFormSubmitPending.value).toBe(true);
    harness.passwordMutation.isPending.value = false;
    harness.setPasswordMethodEnabledMutation.isPending.value = true;
    expect(harness.logic.passwordFormSubmitPending.value).toBe(true);
  });

  it("computes dialog labels from password method requirements", () => {
    const manageHarness = createHarness();
    expect(manageHarness.logic.passwordRequiresExistingSecret.value).toBe(true);
    expect(manageHarness.logic.passwordManageLabel.value).toBe("Change password");
    expect(manageHarness.logic.passwordSubmitLabel.value).toBe("Update password");
    expect(manageHarness.logic.passwordFormSubmitLabel.value).toBe("Update password");
    expect(manageHarness.logic.passwordDialogTitle.value).toBe("Change password");

    const setupHarness = createHarness({
      mode: PASSWORD_FORM_MODE_ENABLE,
      securityData: buildSecurityPayload({
        security: {
          authMethods: [
            {
              id: AUTH_METHOD_PASSWORD_ID,
              kind: AUTH_METHOD_KIND_PASSWORD,
              configured: true,
              enabled: false,
              canEnable: true,
              requiresCurrentPassword: false
            },
            {
              id: "email_otp",
              kind: AUTH_METHOD_KIND_OTP,
              configured: true,
              enabled: true
            }
          ]
        }
      })
    });

    expect(setupHarness.logic.isPasswordEnableSetupMode.value).toBe(true);
    expect(setupHarness.logic.passwordFormSubmitLabel.value).toBe("Enable");
    expect(setupHarness.logic.passwordDialogTitle.value).toBe("Enable password sign-in");
  });
});
