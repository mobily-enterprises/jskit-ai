import { reactive, ref, watch } from "vue";
import { useRouterState } from "@tanstack/vue-router";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { api } from "../../../services/api/index.js";
import { useAuthStore } from "../../../stores/authStore.js";
import { useAuthGuard } from "../../../composables/useAuthGuard.js";
import { SETTINGS_QUERY_KEY, SETTINGS_SECTION_QUERY_KEY } from "../lib/useSettingsPageConfig.js";
import { useSettingsContext } from "../lib/useSettingsContext.js";
import { clearFieldErrors, toErrorMessage } from "../lib/useSettingsSharedHelpers.js";
import { PASSWORD_FORM_MODE_ENABLE, PASSWORD_FORM_MODE_MANAGE } from "./lib/settingsSecurityConfig.js";
import { useSettingsSecurityLogic } from "./lib/useSettingsSecurityLogic.js";
import { useSettingsSecurityOAuthCallback } from "./lib/useSettingsSecurityOAuthCallback.js";
import {
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD
} from "../../../../shared/auth/authMethods.js";

export function useSettingsSecurityForm(options) {
  if (!options) {
    return useSettingsContext().sections.security;
  }

  const { settingsQuery } = options;
  const queryClient = useQueryClient();
  const authStore = useAuthStore();
  const { handleUnauthorizedError } = useAuthGuard();
  const routerPath = useRouterState({
    select: (state) => state.location.pathname
  });
  const routerSearch = useRouterState({
    select: (state) => state.location.search
  });

  const handleAuthError = async (error) => handleUnauthorizedError(error);

  function buildSettingsPathWithTab(tab) {
    const params = new URLSearchParams({
      [SETTINGS_SECTION_QUERY_KEY]: String(tab || "profile")
    });
    const returnTo = String(routerSearch.value?.returnTo || "").trim();
    if (returnTo) {
      params.set("returnTo", returnTo);
    }

    return `${String(routerPath.value || "/account/settings")}?${params.toString()}`;
  }

  const securityForm = reactive({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  const securityFieldErrors = reactive({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });

  const securityMessage = ref("");
  const securityMessageType = ref("success");
  const sessionsMessage = ref("");
  const sessionsMessageType = ref("success");
  const providerMessage = ref("");
  const providerMessageType = ref("success");

  const providerLinkStartInFlight = ref(false);
  const methodActionLoadingId = ref("");

  const showPasswordForm = ref(false);
  const passwordFormMode = ref(PASSWORD_FORM_MODE_MANAGE);
  const showCurrentPassword = ref(false);
  const showNewPassword = ref(false);
  const showConfirmPassword = ref(false);

  const passwordMutation = useMutation({
    mutationFn: (payload) => api.changePassword(payload)
  });
  const setPasswordMethodEnabledMutation = useMutation({
    mutationFn: (payload) => api.setPasswordMethodEnabled(payload)
  });
  const logoutOthersMutation = useMutation({
    mutationFn: () => api.logoutOtherSessions()
  });
  const unlinkProviderMutation = useMutation({
    mutationFn: (providerId) => api.unlinkSettingsOAuthProvider(providerId)
  });

  const {
    passwordMethod,
    isPasswordEnableSetupMode,
    requiresCurrentPassword,
    canSubmitPasswordForm,
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
  } = useSettingsSecurityLogic({
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
    settingsQueryKey: SETTINGS_QUERY_KEY,
    clearFieldErrors,
    toErrorMessage,
    handleAuthError,
    buildSettingsPathWithTab,
    PASSWORD_FORM_MODE_MANAGE,
    PASSWORD_FORM_MODE_ENABLE
  });

  const { handleOAuthCallbackIfPresent } = useSettingsSecurityOAuthCallback({
    authStore,
    queryClient,
    providerMessage,
    providerMessageType,
    providerLinkStartInFlight,
    providerLabel,
    buildSettingsPathWithTab,
    handleAuthError,
    toErrorMessage
  });

  watch(
    () => [
      passwordMethod.value.configured,
      passwordMethod.value.enabled,
      passwordMethod.value.canEnable,
      passwordFormMode.value
    ],
    () => {
      if (!canSubmitPasswordForm.value && showPasswordForm.value) {
        closePasswordForm();
      }
    }
  );

  async function initialize() {
    await handleOAuthCallbackIfPresent();
  }

  function hydrate() {
    // Security state is computed directly from settingsQuery.
  }

  return {
    meta: {
      AUTH_METHOD_KIND_PASSWORD,
      AUTH_METHOD_KIND_OAUTH,
      AUTH_METHOD_KIND_OTP
    },
    state: reactive({
      authMethodItems,
      passwordManageLabel,
      methodActionLoadingId,
      setPasswordMethodEnabledMutation,
      unlinkProviderMutation,
      providerLinkStartInFlight,
      providerMessage,
      providerMessageType,
      showPasswordForm,
      passwordDialogTitle,
      isPasswordEnableSetupMode,
      requiresCurrentPassword,
      securityForm,
      showCurrentPassword,
      showNewPassword,
      showConfirmPassword,
      securityFieldErrors,
      securityMessage,
      securityMessageType,
      passwordFormSubmitPending,
      passwordFormSubmitLabel,
      sessionsMessage,
      sessionsMessageType,
      logoutOthersMutation,
      mfaChipColor,
      mfaLabel,
      securityMethodsHint
    }),
    actions: {
      authMethodStatusText,
      openPasswordForm,
      submitPasswordMethodToggle,
      openPasswordEnableSetup,
      submitProviderUnlink,
      startProviderLink,
      submitPasswordChange,
      closePasswordForm,
      submitLogoutOthers
    },
    hydrate,
    initialize
  };
}
