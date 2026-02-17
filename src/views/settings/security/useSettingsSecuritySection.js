export function useSettingsSecuritySection(settingsView) {
  const { meta, state, actions } = settingsView;

  return {
    meta: {
      AUTH_METHOD_KIND_PASSWORD: meta.AUTH_METHOD_KIND_PASSWORD,
      AUTH_METHOD_KIND_OAUTH: meta.AUTH_METHOD_KIND_OAUTH,
      AUTH_METHOD_KIND_OTP: meta.AUTH_METHOD_KIND_OTP
    },
    state: {
      authMethodItems: state.authMethodItems,
      passwordManageLabel: state.passwordManageLabel,
      methodActionLoadingId: state.methodActionLoadingId,
      setPasswordMethodEnabledMutation: state.setPasswordMethodEnabledMutation,
      unlinkProviderMutation: state.unlinkProviderMutation,
      providerLinkStartInFlight: state.providerLinkStartInFlight,
      providerMessage: state.providerMessage,
      providerMessageType: state.providerMessageType,
      showPasswordForm: state.showPasswordForm,
      passwordDialogTitle: state.passwordDialogTitle,
      isPasswordEnableSetupMode: state.isPasswordEnableSetupMode,
      requiresCurrentPassword: state.requiresCurrentPassword,
      securityForm: state.securityForm,
      showCurrentPassword: state.showCurrentPassword,
      showNewPassword: state.showNewPassword,
      showConfirmPassword: state.showConfirmPassword,
      securityFieldErrors: state.securityFieldErrors,
      securityMessage: state.securityMessage,
      securityMessageType: state.securityMessageType,
      passwordFormSubmitPending: state.passwordFormSubmitPending,
      passwordFormSubmitLabel: state.passwordFormSubmitLabel,
      sessionsMessage: state.sessionsMessage,
      sessionsMessageType: state.sessionsMessageType,
      logoutOthersMutation: state.logoutOthersMutation,
      mfaChipColor: state.mfaChipColor,
      mfaLabel: state.mfaLabel,
      securityMethodsHint: state.securityMethodsHint
    },
    actions: {
      authMethodStatusText: actions.authMethodStatusText,
      openPasswordForm: actions.openPasswordForm,
      submitPasswordMethodToggle: actions.submitPasswordMethodToggle,
      openPasswordEnableSetup: actions.openPasswordEnableSetup,
      submitProviderUnlink: actions.submitProviderUnlink,
      startProviderLink: actions.startProviderLink,
      submitPasswordChange: actions.submitPasswordChange,
      closePasswordForm: actions.closePasswordForm,
      submitLogoutOthers: actions.submitLogoutOthers
    }
  };
}
