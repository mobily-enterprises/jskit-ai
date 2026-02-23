import { computed } from "vue";
import { api } from "../../../../services/api/index.js";
import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_PASSWORD_ID,
  buildOAuthMethodId
} from "../../../../../shared/auth/authMethods.js";
import { AUTH_OAUTH_PROVIDER_METADATA, normalizeOAuthProvider } from "../../../../../shared/auth/oauthProviders.js";
import { writePendingOAuthContext } from "../../../../utils/oauthCallback.js";

export function useSettingsSecurityLogic({
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
  settingsQueryKey,
  clearFieldErrors,
  toErrorMessage,
  handleAuthError,
  buildSettingsPathWithTab,
  PASSWORD_FORM_MODE_MANAGE,
  PASSWORD_FORM_MODE_ENABLE
}) {
  const mfaStatus = computed(() => String(settingsQuery.data.value?.security?.mfa?.status || "not_enabled"));
  const securityStatus = computed(() => {
    const security = settingsQuery.data.value?.security;
    return security && typeof security === "object" ? security : {};
  });

  function createFallbackAuthMethods() {
    return AUTH_METHOD_DEFINITIONS.map((definition) => {
      const alwaysAvailable = definition.kind === AUTH_METHOD_KIND_OTP;
      return {
        id: definition.id,
        kind: definition.kind,
        provider: definition.provider || null,
        label: definition.label,
        configured: alwaysAvailable,
        enabled: alwaysAvailable,
        canEnable: false,
        canDisable: false,
        supportsSecretUpdate: Boolean(definition.supportsSecretUpdate),
        requiresCurrentPassword: false
      };
    });
  }

  function normalizeAuthMethod(rawMethod) {
    const method = rawMethod && typeof rawMethod === "object" ? rawMethod : {};
    const id = String(method.id || "");
    const kind = String(method.kind || "");

    return {
      id,
      kind,
      provider: method.provider == null ? null : String(method.provider || ""),
      label: String(method.label || id || "Method"),
      configured: Boolean(method.configured),
      enabled: Boolean(method.enabled),
      canEnable: Boolean(method.canEnable),
      canDisable: Boolean(method.canDisable),
      supportsSecretUpdate: Boolean(method.supportsSecretUpdate),
      requiresCurrentPassword: Boolean(method.requiresCurrentPassword)
    };
  }

  const securityAuthPolicy = computed(() => {
    const authPolicy = securityStatus.value?.authPolicy;
    if (!authPolicy || typeof authPolicy !== "object") {
      return {
        minimumEnabledMethods: 1,
        enabledMethodsCount: 0
      };
    }

    return {
      minimumEnabledMethods: Number.isInteger(Number(authPolicy.minimumEnabledMethods))
        ? Math.max(1, Number(authPolicy.minimumEnabledMethods))
        : 1,
      enabledMethodsCount: Number.isInteger(Number(authPolicy.enabledMethodsCount))
        ? Math.max(0, Number(authPolicy.enabledMethodsCount))
        : 0
    };
  });

  const securityAuthMethods = computed(() => {
    const methods = securityStatus.value?.authMethods;
    if (!Array.isArray(methods) || methods.length === 0) {
      return createFallbackAuthMethods();
    }

    return methods.map(normalizeAuthMethod).filter((method) => method.id);
  });

  const passwordMethod = computed(
    () =>
      securityAuthMethods.value.find((method) => String(method.id || "") === AUTH_METHOD_PASSWORD_ID) || {
        id: AUTH_METHOD_PASSWORD_ID,
        kind: AUTH_METHOD_KIND_PASSWORD,
        provider: "email",
        label: "Password",
        configured: false,
        enabled: false,
        canEnable: false,
        canDisable: false,
        supportsSecretUpdate: true,
        requiresCurrentPassword: false
      }
  );

  const isPasswordEnableSetupMode = computed(() => passwordFormMode.value === PASSWORD_FORM_MODE_ENABLE);
  const requiresCurrentPassword = computed(() => Boolean(passwordMethod.value.requiresCurrentPassword));
  const canOpenPasswordManageForm = computed(() =>
    Boolean(passwordMethod.value.enabled || !passwordMethod.value.configured)
  );
  const canOpenPasswordEnableSetup = computed(() =>
    Boolean(passwordMethod.value.configured && !passwordMethod.value.enabled && passwordMethod.value.canEnable)
  );
  const canSubmitPasswordForm = computed(() =>
    isPasswordEnableSetupMode.value ? canOpenPasswordEnableSetup.value : canOpenPasswordManageForm.value
  );
  const passwordRequiresExistingSecret = computed(() =>
    Boolean(passwordMethod.value.enabled && passwordMethod.value.requiresCurrentPassword)
  );
  const passwordSubmitLabel = computed(() =>
    passwordRequiresExistingSecret.value ? "Update password" : "Set password"
  );
  const passwordManageLabel = computed(() =>
    passwordRequiresExistingSecret.value ? "Change password" : "Set password"
  );
  const passwordDialogTitle = computed(() =>
    isPasswordEnableSetupMode.value ? "Enable password sign-in" : passwordManageLabel.value
  );
  const passwordFormSubmitLabel = computed(() =>
    isPasswordEnableSetupMode.value ? "Enable" : passwordSubmitLabel.value
  );
  const passwordFormSubmitPending = computed(
    () => passwordMutation.isPending.value || setPasswordMethodEnabledMutation.isPending.value
  );
  const authMethodItems = computed(() =>
    securityAuthMethods.value.filter((method) => method.kind !== AUTH_METHOD_KIND_OTP)
  );
  const securityMethodsHint = computed(() => {
    const minimum = securityAuthPolicy.value.minimumEnabledMethods;
    if (minimum <= 1) {
      return "At least one sign-in method must remain enabled.";
    }

    return `At least ${minimum} sign-in methods must remain enabled.`;
  });
  const mfaLabel = computed(() => {
    if (mfaStatus.value === "enabled") {
      return "MFA enabled";
    }
    return "MFA not enabled";
  });
  const mfaChipColor = computed(() => {
    if (mfaStatus.value === "enabled") {
      return "primary";
    }
    return "secondary";
  });

  function providerLabel(providerId) {
    const normalized = normalizeOAuthProvider(providerId, { fallback: null });
    if (!normalized) {
      return String(providerId || "Provider");
    }

    return String(AUTH_OAUTH_PROVIDER_METADATA[normalized]?.label || normalized);
  }

  function authMethodStatusText(method) {
    const normalized = method && typeof method === "object" ? method : {};
    if (normalized.kind === AUTH_METHOD_KIND_OTP) {
      return "Always available";
    }
    if (normalized.kind === AUTH_METHOD_KIND_OAUTH) {
      return normalized.enabled ? "Linked" : "Not linked";
    }

    if (normalized.enabled) {
      return "Enabled";
    }
    if (normalized.configured) {
      return "Configured but disabled";
    }

    return "Not configured";
  }

  async function submitPasswordChange() {
    if (!canSubmitPasswordForm.value) {
      securityMessageType.value = "error";
      securityMessage.value = isPasswordEnableSetupMode.value
        ? "Password sign-in cannot be enabled right now."
        : "Enable password sign-in before setting or changing password.";
      return;
    }

    clearFieldErrors(securityFieldErrors);
    securityMessage.value = "";
    const enableAfterPasswordSetup = isPasswordEnableSetupMode.value;
    if (enableAfterPasswordSetup) {
      methodActionLoadingId.value = AUTH_METHOD_PASSWORD_ID;
    }

    try {
      const response = await passwordMutation.mutateAsync({
        currentPassword: requiresCurrentPassword.value ? securityForm.currentPassword : undefined,
        newPassword: securityForm.newPassword,
        confirmPassword: securityForm.confirmPassword
      });

      if (enableAfterPasswordSetup) {
        const data = await setPasswordMethodEnabledMutation.mutateAsync({
          enabled: true
        });
        queryClient.setQueryData(settingsQueryKey, data);
        providerMessageType.value = "success";
        providerMessage.value = "Password sign-in enabled.";
        securityMessageType.value = "success";
        securityMessage.value = "Password sign-in enabled.";
      } else {
        securityMessageType.value = "success";
        securityMessage.value = String(response?.message || "Password updated.");
      }

      closePasswordForm();
      await queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      if (error?.fieldErrors && typeof error.fieldErrors === "object") {
        for (const key of Object.keys(securityFieldErrors)) {
          if (error.fieldErrors[key]) {
            securityFieldErrors[key] = String(error.fieldErrors[key]);
          }
        }
      }

      securityMessageType.value = "error";
      securityMessage.value = toErrorMessage(
        error,
        enableAfterPasswordSetup ? "Unable to enable password sign-in." : "Unable to update password."
      );
    } finally {
      if (enableAfterPasswordSetup) {
        methodActionLoadingId.value = "";
      }
    }
  }

  function openPasswordForm() {
    if (!canOpenPasswordManageForm.value) {
      securityMessageType.value = "error";
      securityMessage.value = "Enable password sign-in before setting or changing password.";
      return;
    }

    providerMessage.value = "";
    passwordFormMode.value = PASSWORD_FORM_MODE_MANAGE;
    securityForm.currentPassword = "";
    securityForm.newPassword = "";
    securityForm.confirmPassword = "";
    showCurrentPassword.value = false;
    showNewPassword.value = false;
    showConfirmPassword.value = false;
    clearFieldErrors(securityFieldErrors);
    securityMessage.value = "";
    showPasswordForm.value = true;
  }

  function openPasswordEnableSetup() {
    if (!canOpenPasswordEnableSetup.value) {
      providerMessageType.value = "error";
      providerMessage.value = "Password sign-in cannot be enabled right now.";
      return;
    }

    providerMessage.value = "";
    passwordFormMode.value = PASSWORD_FORM_MODE_ENABLE;
    securityForm.currentPassword = "";
    securityForm.newPassword = "";
    securityForm.confirmPassword = "";
    showCurrentPassword.value = false;
    showNewPassword.value = false;
    showConfirmPassword.value = false;
    clearFieldErrors(securityFieldErrors);
    securityMessage.value = "";
    showPasswordForm.value = true;
  }

  function closePasswordForm() {
    showPasswordForm.value = false;
    passwordFormMode.value = PASSWORD_FORM_MODE_MANAGE;
    securityForm.currentPassword = "";
    securityForm.newPassword = "";
    securityForm.confirmPassword = "";
    showCurrentPassword.value = false;
    showNewPassword.value = false;
    showConfirmPassword.value = false;
    clearFieldErrors(securityFieldErrors);
    securityMessage.value = "";
  }

  async function submitPasswordMethodToggle(enabled) {
    providerMessage.value = "";
    methodActionLoadingId.value = AUTH_METHOD_PASSWORD_ID;

    try {
      const data = await setPasswordMethodEnabledMutation.mutateAsync({
        enabled
      });
      queryClient.setQueryData(settingsQueryKey, data);
      providerMessageType.value = "success";
      providerMessage.value = enabled ? "Password sign-in enabled." : "Password sign-in disabled.";
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      providerMessageType.value = "error";
      providerMessage.value = toErrorMessage(error, "Unable to update password sign-in method.");
    } finally {
      methodActionLoadingId.value = "";
    }
  }

  async function startProviderLink(providerId) {
    const provider = normalizeOAuthProvider(providerId, { fallback: null });
    if (!provider) {
      providerMessageType.value = "error";
      providerMessage.value = "OAuth provider is not supported.";
      return;
    }

    providerMessage.value = "";
    providerLinkStartInFlight.value = true;
    const returnTo = buildSettingsPathWithTab("security");
    writePendingOAuthContext({
      provider,
      intent: "link",
      returnTo
    });

    if (typeof window !== "undefined") {
      window.location.assign(api.settings.oauthLinkStartUrl(provider, { returnTo }));
      return;
    }

    providerLinkStartInFlight.value = false;
  }

  async function submitProviderUnlink(providerId) {
    const provider = normalizeOAuthProvider(providerId, { fallback: null });
    if (!provider) {
      providerMessageType.value = "error";
      providerMessage.value = "OAuth provider is not supported.";
      return;
    }

    providerMessage.value = "";
    methodActionLoadingId.value = buildOAuthMethodId(provider) || provider;

    try {
      const data = await unlinkProviderMutation.mutateAsync(provider);
      queryClient.setQueryData(settingsQueryKey, data);
      providerMessageType.value = "success";
      providerMessage.value = `${providerLabel(provider)} unlinked.`;
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      providerMessageType.value = "error";
      providerMessage.value = toErrorMessage(error, "Unable to unlink provider.");
    } finally {
      methodActionLoadingId.value = "";
    }
  }

  async function submitLogoutOthers() {
    sessionsMessage.value = "";

    try {
      const response = await logoutOthersMutation.mutateAsync();
      sessionsMessageType.value = "success";
      sessionsMessage.value = String(response?.message || "Signed out from other active sessions.");
    } catch (error) {
      if (await handleAuthError(error)) {
        return;
      }

      sessionsMessageType.value = "error";
      sessionsMessage.value = toErrorMessage(error, "Unable to sign out other sessions.");
    }
  }

  return {
    createFallbackAuthMethods,
    normalizeAuthMethod,
    mfaStatus,
    securityStatus,
    securityAuthPolicy,
    securityAuthMethods,
    passwordMethod,
    isPasswordEnableSetupMode,
    requiresCurrentPassword,
    canOpenPasswordManageForm,
    canOpenPasswordEnableSetup,
    canSubmitPasswordForm,
    passwordRequiresExistingSecret,
    passwordSubmitLabel,
    passwordManageLabel,
    passwordDialogTitle,
    passwordFormSubmitLabel,
    passwordFormSubmitPending,
    authMethodItems,
    securityMethodsHint,
    mfaLabel,
    mfaChipColor,
    providerLabel,
    authMethodStatusText,
    submitPasswordChange,
    openPasswordForm,
    openPasswordEnableSetup,
    closePasswordForm,
    submitPasswordMethodToggle,
    startProviderLink,
    submitProviderUnlink,
    submitLogoutOthers
  };
}
