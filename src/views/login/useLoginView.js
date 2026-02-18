import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation } from "@tanstack/vue-query";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { AUTH_OAUTH_PROVIDER_METADATA, AUTH_OAUTH_PROVIDERS } from "../../../shared/auth/oauthProviders.js";
import { api } from "../../services/api/index.js";
import { useAuthStore } from "../../stores/authStore.js";
import { useWorkspaceStore } from "../../stores/workspaceStore.js";
import { useLoginActions } from "./lib/useLoginActions.js";
import { useLoginDerivedState } from "./lib/useLoginDerivedState.js";

export function useLoginView() {
  const navigate = useNavigate();
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();
  const surfacePaths = computed(() =>
    resolveSurfacePaths(typeof window !== "undefined" ? window.location.pathname : "/")
  );

  const mode = ref("login");
  const email = ref("");
  const password = ref("");
  const confirmPassword = ref("");
  const otpCode = ref("");
  const showPassword = ref(false);
  const showConfirmPassword = ref(false);
  const emailTouched = ref(false);
  const passwordTouched = ref(false);
  const confirmPasswordTouched = ref(false);
  const otpCodeTouched = ref(false);
  const submitAttempted = ref(false);
  const errorMessage = ref("");
  const infoMessage = ref("");
  const rememberAccountOnDevice = ref(true);
  const rememberedAccount = ref(null);
  const useRememberedAccount = ref(false);
  const oauthCallbackInFlight = ref(false);

  const oauthProviders = AUTH_OAUTH_PROVIDERS.map((providerId) => AUTH_OAUTH_PROVIDER_METADATA[providerId]).filter(
    Boolean
  );

  const registerMutation = useMutation({
    mutationFn: (payload) => api.register(payload)
  });
  const loginMutation = useMutation({
    mutationFn: (payload) => api.login(payload)
  });
  const forgotPasswordMutation = useMutation({
    mutationFn: (payload) => api.requestPasswordReset(payload)
  });
  const otpRequestMutation = useMutation({
    mutationFn: (payload) => api.requestOtpLogin(payload)
  });
  const otpVerifyMutation = useMutation({
    mutationFn: (payload) => api.verifyOtpLogin(payload)
  });

  const loading = computed(
    () =>
      registerMutation.isPending.value ||
      loginMutation.isPending.value ||
      forgotPasswordMutation.isPending.value ||
      otpRequestMutation.isPending.value ||
      otpVerifyMutation.isPending.value ||
      oauthCallbackInFlight.value
  );
  const otpRequestPending = computed(() => otpRequestMutation.isPending.value);

  const {
    isLogin,
    isRegister,
    isForgot,
    isOtp,
    showRememberedAccount,
    rememberedAccountDisplayName,
    rememberedAccountMaskedEmail,
    rememberedAccountSwitchLabel,
    authTitle,
    authSubtitle,
    submitLabel,
    emailErrorMessages,
    passwordErrorMessages,
    confirmPasswordErrorMessages,
    otpCodeErrorMessages,
    canSubmit
  } = useLoginDerivedState({
    mode,
    rememberedAccount,
    useRememberedAccount,
    submitAttempted,
    emailTouched,
    passwordTouched,
    confirmPasswordTouched,
    otpCodeTouched,
    email,
    password,
    confirmPassword,
    otpCode,
    loading
  });

  const {
    switchMode,
    switchAccount,
    requestOtpCode,
    startOAuthSignIn,
    oauthProviderButtonLabel,
    oauthProviderIcon,
    submitAuth,
    initializeLoginView
  } = useLoginActions({
    mode,
    email,
    password,
    confirmPassword,
    otpCode,
    showPassword,
    showConfirmPassword,
    emailTouched,
    passwordTouched,
    confirmPasswordTouched,
    otpCodeTouched,
    submitAttempted,
    errorMessage,
    infoMessage,
    rememberAccountOnDevice,
    rememberedAccount,
    useRememberedAccount,
    oauthCallbackInFlight,
    isRegister,
    isForgot,
    isOtp,
    showRememberedAccount,
    rememberedAccountDisplayName,
    canSubmit,
    surfacePaths,
    navigate,
    authStore,
    workspaceStore,
    registerMutation,
    loginMutation,
    forgotPasswordMutation,
    otpRequestMutation,
    otpVerifyMutation
  });

  onMounted(async () => {
    await initializeLoginView();
  });

  return {
    content: {
      authTitle,
      authSubtitle,
      submitLabel
    },
    mode: reactive({
      isLogin,
      isRegister,
      isForgot,
      isOtp,
      showRememberedAccount,
      rememberedAccountDisplayName,
      rememberedAccountMaskedEmail,
      rememberedAccountSwitchLabel
    }),
    form: reactive({
      email,
      password,
      confirmPassword,
      otpCode,
      showPassword,
      showConfirmPassword,
      emailTouched,
      passwordTouched,
      confirmPasswordTouched,
      otpCodeTouched,
      rememberAccountOnDevice
    }),
    validation: reactive({
      emailErrorMessages,
      passwordErrorMessages,
      confirmPasswordErrorMessages,
      otpCodeErrorMessages,
      canSubmit
    }),
    feedback: reactive({
      loading,
      otpRequestPending,
      errorMessage,
      infoMessage
    }),
    oauth: {
      providers: oauthProviders,
      providerButtonLabel: oauthProviderButtonLabel,
      providerIcon: oauthProviderIcon
    },
    actions: {
      switchMode,
      switchAccount,
      requestOtpCode,
      startOAuthSignIn,
      submitAuth
    }
  };
}
