import { computed, ref } from "vue";
import {
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import {
  normalizeAuthReturnToPath,
  resolveAllowedReturnToOriginsFromPlacementContext
} from "../../lib/returnToPath.js";
import {
  LOGIN_MODE,
  REGISTER_MODE,
  FORGOT_MODE,
  OTP_MODE,
  EMAIL_CONFIRMATION_MODE,
  AUTH_TITLE_BY_MODE,
  AUTH_SUBTITLE_BY_MODE,
  SUBMIT_LABEL_BY_MODE
} from "./constants.js";
import { normalizeEmailAddress, maskEmail } from "./identityHelpers.js";
import {
  createRememberedAccountHint,
  writeRememberedAccountHint,
  clearRememberedAccountHint
} from "./rememberedAccountStorage.js";

export function useLoginViewState({ placementContext } = {}) {
  const mode = ref(LOGIN_MODE);
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
  const rememberAccountOnDevice = ref(true);
  const rememberedAccount = ref(null);
  const useRememberedAccount = ref(false);
  const oauthProviders = ref([]);
  const oauthDefaultProvider = ref("");
  const loading = ref(false);
  const otpRequestPending = ref(false);
  const registerConfirmationResendPending = ref(false);
  const errorMessage = ref("");
  const infoMessage = ref("");
  const pendingEmailConfirmationMessage = ref("");
  const pendingEmailConfirmationAddress = ref("");

  const isLogin = computed(() => mode.value === LOGIN_MODE);
  const isRegister = computed(() => mode.value === REGISTER_MODE);
  const isForgot = computed(() => mode.value === FORGOT_MODE);
  const isOtp = computed(() => mode.value === OTP_MODE);
  const isEmailConfirmationPending = computed(() => mode.value === EMAIL_CONFIRMATION_MODE);
  const showRememberedAccount = computed(
    () => (isLogin.value || isOtp.value) && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));
  const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
  const rememberedAccountSwitchLabel = "Use another account";
  const authTitle = computed(() => AUTH_TITLE_BY_MODE[mode.value] || AUTH_TITLE_BY_MODE[LOGIN_MODE]);
  const authSubtitle = computed(() => {
    if (isEmailConfirmationPending.value) {
      const maskedEmail = maskEmail(pendingEmailConfirmationAddress.value);
      if (maskedEmail) {
        return `Open the confirmation link sent to ${maskedEmail} to finish signing in.`;
      }
      return "Open the confirmation link from your inbox to finish signing in.";
    }
    return AUTH_SUBTITLE_BY_MODE[mode.value] || AUTH_SUBTITLE_BY_MODE[LOGIN_MODE];
  });
  const submitLabel = computed(() => SUBMIT_LABEL_BY_MODE[mode.value] || SUBMIT_LABEL_BY_MODE[LOGIN_MODE]);
  const allowedReturnToOrigins = computed(() =>
    resolveAllowedReturnToOriginsFromPlacementContext(placementContext?.value)
  );
  const requestedReturnTo = ref(
    normalizeAuthReturnToPath(
      typeof window === "object" ? new URLSearchParams(window.location.search || "").get("returnTo") : "/",
      "/",
      {
        allowedOrigins: allowedReturnToOrigins.value
      }
    )
  );
  const mainScreenPath = computed(() => {
    const normalizedReturnTo = normalizeAuthReturnToPath(requestedReturnTo.value, "/", {
      allowedOrigins: allowedReturnToOrigins.value
    });
    const surfaceId = resolveSurfaceIdFromPlacementPathname(placementContext?.value, normalizedReturnTo);
    const rootPath = resolveSurfaceRootPathFromPlacementContext(placementContext?.value, surfaceId || "");
    return normalizeAuthReturnToPath(rootPath, "/", {
      allowedOrigins: allowedReturnToOrigins.value
    });
  });
  const emailConfirmationMessage = computed(
    () =>
      String(pendingEmailConfirmationMessage.value || "").trim() ||
      "Please confirm your email address. After confirmation, you can sign in."
  );

  function clearTransientMessages() {
    errorMessage.value = "";
    infoMessage.value = "";
  }

  function resetTransientValidationState() {
    submitAttempted.value = false;
    emailTouched.value = false;
    passwordTouched.value = false;
    confirmPasswordTouched.value = false;
    otpCodeTouched.value = false;
  }

  function clearRememberedAccountState() {
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
  }

  function resetCredentialFields() {
    password.value = "";
    confirmPassword.value = "";
    otpCode.value = "";
    showPassword.value = false;
    showConfirmPassword.value = false;
  }

  function resolveNormalizedEmail() {
    return normalizeEmailAddress(email.value);
  }

  function applyRememberedAccountHint(hint) {
    if (!hint) {
      clearRememberedAccountState();
      return;
    }

    rememberedAccount.value = hint;
    useRememberedAccount.value = true;
    rememberAccountOnDevice.value = true;
    email.value = String(hint.email || "").trim();
  }

  function applyRememberedAccountPreference({ email: accountEmail, displayName, shouldRemember } = {}) {
    const rememberedHint = createRememberedAccountHint({
      email: accountEmail,
      displayName,
      lastUsedAt: new Date().toISOString()
    });

    if (shouldRemember && rememberedHint) {
      writeRememberedAccountHint(rememberedHint);
      applyRememberedAccountHint(rememberedHint);
      return;
    }

    clearRememberedAccountHint();
    clearRememberedAccountState();
  }

  function switchAccount() {
    clearRememberedAccountHint();
    clearRememberedAccountState();
    rememberAccountOnDevice.value = false;
    mode.value = LOGIN_MODE;
    email.value = "";
    resetCredentialFields();
    clearTransientMessages();
    resetTransientValidationState();
  }

  function switchMode(nextMode) {
    if (nextMode === mode.value) {
      return;
    }

    mode.value = nextMode;
    resetCredentialFields();
    registerConfirmationResendPending.value = false;
    if (nextMode !== EMAIL_CONFIRMATION_MODE) {
      pendingEmailConfirmationAddress.value = "";
      pendingEmailConfirmationMessage.value = "";
    }
    clearTransientMessages();
    resetTransientValidationState();

    if (nextMode !== LOGIN_MODE && nextMode !== OTP_MODE) {
      useRememberedAccount.value = false;
      return;
    }

    if (rememberedAccount.value) {
      useRememberedAccount.value = true;
    }
  }

  function enterEmailConfirmationPendingState({ emailAddress = "", message = "" } = {}) {
    switchMode(EMAIL_CONFIRMATION_MODE);
    pendingEmailConfirmationAddress.value = normalizeEmailAddress(emailAddress);
    pendingEmailConfirmationMessage.value = String(message || "").trim();
  }

  function goToMainScreen() {
    if (typeof window !== "object" || !window.location || typeof window.location.assign !== "function") {
      return;
    }
    window.location.assign(mainScreenPath.value);
  }

  return {
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
    rememberAccountOnDevice,
    rememberedAccount,
    useRememberedAccount,
    oauthProviders,
    oauthDefaultProvider,
    loading,
    otpRequestPending,
    registerConfirmationResendPending,
    errorMessage,
    infoMessage,
    pendingEmailConfirmationMessage,
    pendingEmailConfirmationAddress,
    isLogin,
    isRegister,
    isForgot,
    isOtp,
    isEmailConfirmationPending,
    showRememberedAccount,
    rememberedAccountDisplayName,
    rememberedAccountMaskedEmail,
    rememberedAccountSwitchLabel,
    authTitle,
    authSubtitle,
    submitLabel,
    allowedReturnToOrigins,
    requestedReturnTo,
    mainScreenPath,
    emailConfirmationMessage,
    resolveNormalizedEmail,
    applyRememberedAccountHint,
    applyRememberedAccountPreference,
    clearTransientMessages,
    switchMode,
    switchAccount,
    enterEmailConfirmationPendingState,
    goToMainScreen
  };
}
