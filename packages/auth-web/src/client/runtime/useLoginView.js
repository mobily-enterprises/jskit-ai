import { onMounted } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useLoginViewState } from "../composables/loginView/useLoginViewState.js";
import { useLoginViewValidation } from "../composables/loginView/useLoginViewValidation.js";
import { useLoginViewActions } from "../composables/loginView/useLoginViewActions.js";

function useLoginView() {
  const { context: placementContext } = useWebPlacementContext();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();

  const state = useLoginViewState({ placementContext });
  const validation = useLoginViewValidation({ state });
  const actions = useLoginViewActions({
    state,
    validation,
    queryClient,
    errorRuntime
  });

  onMounted(actions.initializeOnMounted);

  return {
    authTitle: state.authTitle,
    authSubtitle: state.authSubtitle,
    isForgot: state.isForgot,
    isOtp: state.isOtp,
    isLogin: state.isLogin,
    isRegister: state.isRegister,
    isEmailConfirmationPending: state.isEmailConfirmationPending,
    emailConfirmationMessage: state.emailConfirmationMessage,
    showRememberedAccount: state.showRememberedAccount,
    switchMode: state.switchMode,
    goToMainScreen: state.goToMainScreen,
    submitAuth: actions.submitAuth,
    rememberedAccountDisplayName: state.rememberedAccountDisplayName,
    rememberedAccountMaskedEmail: state.rememberedAccountMaskedEmail,
    rememberedAccountSwitchLabel: state.rememberedAccountSwitchLabel,
    switchAccount: state.switchAccount,
    email: state.email,
    emailErrorMessages: validation.emailErrorMessages,
    emailTouched: state.emailTouched,
    password: state.password,
    showPassword: state.showPassword,
    passwordErrorMessages: validation.passwordErrorMessages,
    passwordTouched: state.passwordTouched,
    confirmPassword: state.confirmPassword,
    showConfirmPassword: state.showConfirmPassword,
    confirmPasswordErrorMessages: validation.confirmPasswordErrorMessages,
    confirmPasswordTouched: state.confirmPasswordTouched,
    otpCode: state.otpCode,
    otpCodeErrorMessages: validation.otpCodeErrorMessages,
    otpCodeTouched: state.otpCodeTouched,
    rememberAccountOnDevice: state.rememberAccountOnDevice,
    otpRequestPending: state.otpRequestPending,
    registerConfirmationResendPending: state.registerConfirmationResendPending,
    requestOtpCode: actions.requestOtpCode,
    resendRegisterConfirmationEmail: actions.resendRegisterConfirmationEmail,
    oauthProviders: state.oauthProviders,
    loading: state.loading,
    oauthProviderIcon: actions.oauthProviderIcon,
    startOAuthSignIn: actions.startOAuthSignIn,
    oauthProviderButtonLabel: actions.oauthProviderButtonLabel,
    errorMessage: state.errorMessage,
    infoMessage: state.infoMessage,
    canSubmit: validation.canSubmit,
    submitLabel: state.submitLabel
  };
}

export { useLoginView };
