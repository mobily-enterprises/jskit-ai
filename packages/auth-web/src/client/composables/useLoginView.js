import { onMounted } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAuthGuardRuntime, useAuthOAuthLaunchClient } from "../runtime/inject.js";
import { useLoginViewState } from "./loginView/useLoginViewState.js";
import { useLoginViewValidation } from "./loginView/useLoginViewValidation.js";
import { useLoginViewActions } from "./loginView/useLoginViewActions.js";
import { useSessionRecheckOnShow } from "./loginView/useSessionRecheckOnShow.js";

/**
 * Everything the sign-in page does, without its look: the modes (sign in, register, forgot password, one-time code,
 * confirm your email), the fields and their errors, the provider buttons, the remembered account, invitations, the
 * returnTo landing and the session check on mount and on return to the page. `DefaultLoginView` renders it in
 * Material 3; an app with its own design system renders it in its own (`@jskit-ai/auth-web/client/composables/useLoginView`).
 * Call it in a component's setup. A refusal sets `errorMessage` and is also reported to the shell's error runtime.
 * @param {{ fallbackReturnTo?: string }} [options] where a sign-in lands without a usable returnTo
 */
function useLoginView({ fallbackReturnTo = "/" } = {}) {
  const { context: placementContext } = useWebPlacementContext();
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();

  const state = useLoginViewState({
    placementContext,
    fallbackReturnTo,
    signedIn: useAuthGuardRuntime().getState()?.authenticated === true
  });
  const validation = useLoginViewValidation({ state });
  const actions = useLoginViewActions({
    state,
    validation,
    queryClient,
    errorRuntime,
    oauthLaunchClient: useAuthOAuthLaunchClient()
  });

  onMounted(actions.initializeOnMounted);
  useSessionRecheckOnShow(actions.redirectIfSignedIn);

  return {
    authTitle: state.authTitle,
    authSubtitle: state.authSubtitle,
    isForgot: state.isForgot,
    isOtp: state.isOtp,
    isLogin: state.isLogin,
    isRegister: state.isRegister,
    isEmailConfirmationPending: state.isEmailConfirmationPending,
    redirectingSignedIn: state.redirectingSignedIn,
    canUsePasswordLogin: state.canUsePasswordLogin,
    canRegister: state.canRegister,
    canRequestPasswordRecovery: state.canRequestPasswordRecovery,
    canUseOtp: state.canUseOtp,
    canUseOAuth: state.canUseOAuth,
    canResendEmailConfirmation: state.canResendEmailConfirmation,
    canEnterConfirmationCode: state.canEnterConfirmationCode,
    needsFirstAccountSetupCode: state.needsFirstAccountSetupCode,
    setupCode: state.setupCode,
    confirmationUrl: state.confirmationUrl,
    confirmationCode: state.confirmationCode,
    confirmationLinkToken: state.confirmationLinkToken,
    registrationConfirmPending: state.registrationConfirmPending,
    confirmRegistrationCode: actions.confirmRegistrationCode,
    confirmRegistrationFromLink: actions.confirmRegistrationFromLink,
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
    // The provider's Material Symbols alias ("$google"), for DefaultLoginView's buttons; an app's own view picks its
    // own icon from `provider.id`.
    oauthProviderIcon: actions.oauthProviderIcon,
    startOAuthSignIn: actions.startOAuthSignIn,
    oauthProviderButtonLabel: actions.oauthProviderButtonLabel,
    errorMessage: state.errorMessage,
    infoMessage: state.infoMessage,
    signInPausedMinutes: state.signInPausedMinutes,
    oauthRetryProvider: state.oauthRetryProvider,
    canSubmit: validation.canSubmit,
    submitLabel: state.submitLabel
  };
}

export { useLoginView };
