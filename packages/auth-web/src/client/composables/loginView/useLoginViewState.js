import { computed, ref } from "vue";
import { normalizeAuthCapabilities } from "@jskit-ai/auth-core/shared/authCapabilities";
import {
  resolveAllowedOriginsFromPlacementContext,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext
} from "@jskit-ai/shell-web/client/placement";
import { normalizeAuthReturnToPath } from "../../lib/returnToPath.js";
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
import { pageLocation } from "../../browser.js";
import { useJskitText } from "../../i18n.js";
import {
  createRememberedAccountHint,
  writeRememberedAccountHint,
  clearRememberedAccountHint
} from "./rememberedAccountStorage.js";

function readWindowSearchParam(name = "") {
  return String(new URLSearchParams(pageLocation()?.search || "").get(name) || "").trim();
}

function resolveInitialMode() {
  const mode = readWindowSearchParam("mode").toLowerCase();
  if ([LOGIN_MODE, REGISTER_MODE, FORGOT_MODE, OTP_MODE].includes(mode)) {
    return mode;
  }
  return LOGIN_MODE;
}

/** @param {{ placementContext: import("vue").Ref<Record<string, any> | null> }} options */
export function useLoginViewState({ placementContext }) {
  const { t } = useJskitText();
  const mode = ref(resolveInitialMode());
  const email = ref(normalizeEmailAddress(readWindowSearchParam("email")));
  const password = ref("");
  const confirmPassword = ref("");
  const otpCode = ref("");
  // The first account's setup code, asked for while a production server has no account.
  const setupCode = ref("");
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
  const authCapabilities = ref(normalizeAuthCapabilities());
  const oauthProviders = ref([]);
  const oauthDefaultProvider = ref("");
  const loading = ref(false);
  const otpRequestPending = ref(false);
  const registerConfirmationResendPending = ref(false);
  const registrationConfirmPending = ref(false);
  const errorMessage = ref("");
  const infoMessage = ref("");
  const pendingEmailConfirmationMessage = ref("");
  const pendingEmailConfirmationAddress = ref("");
  // In development without an email sender, the confirmation link itself.
  const confirmationUrl = ref("");
  // A confirmation code or link the person types or pastes.
  const confirmationCode = ref("");
  // The code of the confirmation link this page was opened with, confirmed with the password typed next to it.
  const confirmationLinkToken = ref("");
  const invitationToken = ref(readWindowSearchParam("invitationToken") || readWindowSearchParam("inviteToken"));

  const isLogin = computed(() => mode.value === LOGIN_MODE);
  const isRegister = computed(() => mode.value === REGISTER_MODE);
  const isForgot = computed(() => mode.value === FORGOT_MODE);
  const isOtp = computed(() => mode.value === OTP_MODE);
  const isEmailConfirmationPending = computed(() => mode.value === EMAIL_CONFIRMATION_MODE);
  const canUsePasswordLogin = computed(() => authCapabilities.value.features.password.login === true);
  // An app whose accounts are by invitation offers registering only to an invited person (or its first account).
  const canRegister = computed(() => {
    const { register, selfRegister } = authCapabilities.value.features.password;
    return register === true && (selfRegister === true || Boolean(String(invitationToken.value || "").trim()));
  });
  const canRequestPasswordRecovery = computed(
    () => authCapabilities.value.features.passwordRecovery.request === true
  );
  const canUseOtp = computed(() => authCapabilities.value.features.otp.login === true);
  const canUseOAuth = computed(() => authCapabilities.value.features.oauthLogin.enabled === true);
  const canResendEmailConfirmation = computed(() => authCapabilities.value.features.emailConfirmation === true);
  const canEnterConfirmationCode = computed(() => authCapabilities.value.features.emailConfirmationCode === true);
  const needsFirstAccountSetupCode = computed(() => authCapabilities.value.features.firstAccountSetupCode === true);
  const showRememberedAccount = computed(
    () => (isLogin.value || isOtp.value) && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(
    () => String(rememberedAccount.value?.displayName || t("jskit.auth.login.rememberedAccount.fallbackName"))
  );
  const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
  const rememberedAccountSwitchLabel = computed(() => t("jskit.auth.login.rememberedAccount.switch"));
  // An empty key (the plain login mode) shows nothing.
  function modeText(keysByMode) {
    const key = keysByMode[mode.value] || keysByMode[LOGIN_MODE];
    return key ? t(key) : "";
  }
  const authTitle = computed(() => modeText(AUTH_TITLE_BY_MODE));
  const authSubtitle = computed(() => {
    if (isEmailConfirmationPending.value) {
      if (confirmationLinkToken.value) {
        return t("jskit.auth.login.subtitle.confirmEmailPassword");
      }
      const maskedEmail = maskEmail(pendingEmailConfirmationAddress.value);
      if (maskedEmail) {
        return t("jskit.auth.login.subtitle.confirmEmailSentTo", { email: maskedEmail });
      }
      return t("jskit.auth.login.subtitle.confirmEmailInbox");
    }
    return modeText(AUTH_SUBTITLE_BY_MODE);
  });
  const submitLabel = computed(() => modeText(SUBMIT_LABEL_BY_MODE));
  const allowedReturnToOrigins = computed(() =>
    resolveAllowedOriginsFromPlacementContext(placementContext.value)
  );
  const requestedReturnTo = ref(
    normalizeAuthReturnToPath(readWindowSearchParam("returnTo"), "/", {
      allowedOrigins: allowedReturnToOrigins.value
    })
  );
  const mainScreenPath = computed(() => {
    const normalizedReturnTo = normalizeAuthReturnToPath(requestedReturnTo.value, "/", {
      allowedOrigins: allowedReturnToOrigins.value
    });
    const surfaceId = resolveSurfaceIdFromPlacementPathname(placementContext.value, normalizedReturnTo);
    const rootPath = resolveSurfaceRootPathFromPlacementContext(placementContext.value, surfaceId || "");
    return normalizeAuthReturnToPath(rootPath, "/", {
      allowedOrigins: allowedReturnToOrigins.value
    });
  });
  const emailConfirmationMessage = computed(
    () =>
      String(pendingEmailConfirmationMessage.value || "").trim() ||
      t("jskit.auth.login.confirmEmail.message")
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
    setupCode.value = "";
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

  function applyCapabilities(payload = {}) {
    authCapabilities.value = normalizeAuthCapabilities(payload.authCapabilities || payload.capabilities || {});
    const oauth = authCapabilities.value.features.oauthLogin;
    if (oauth.enabled) {
      oauthProviders.value = oauth.providers;
      oauthDefaultProvider.value = oauth.defaultProvider || "";
    } else {
      oauthProviders.value = [];
      oauthDefaultProvider.value = "";
    }
    if (
      (mode.value === REGISTER_MODE && !canRegister.value) ||
      (mode.value === FORGOT_MODE && !canRequestPasswordRecovery.value) ||
      (mode.value === OTP_MODE && !canUseOtp.value)
    ) {
      switchMode(LOGIN_MODE);
    }
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
    let resolvedMode = nextMode;
    if (resolvedMode === REGISTER_MODE && !canRegister.value) {
      resolvedMode = LOGIN_MODE;
    } else if (resolvedMode === FORGOT_MODE && !canRequestPasswordRecovery.value) {
      resolvedMode = LOGIN_MODE;
    } else if (resolvedMode === OTP_MODE && !canUseOtp.value) {
      resolvedMode = LOGIN_MODE;
    }

    if (resolvedMode === mode.value) {
      return;
    }

    mode.value = resolvedMode;
    resetCredentialFields();
    registerConfirmationResendPending.value = false;
    if (resolvedMode !== EMAIL_CONFIRMATION_MODE) {
      pendingEmailConfirmationAddress.value = "";
      pendingEmailConfirmationMessage.value = "";
      confirmationUrl.value = "";
      confirmationCode.value = "";
      confirmationLinkToken.value = "";
    }
    clearTransientMessages();
    resetTransientValidationState();

    if (resolvedMode !== LOGIN_MODE && resolvedMode !== OTP_MODE) {
      useRememberedAccount.value = false;
      return;
    }

    if (rememberedAccount.value) {
      useRememberedAccount.value = true;
    }
  }

  /**
   * Shows "Confirm your email". Confirming takes the registration's password:
   * the one just typed to register or sign in stays in its field, and a page
   * opened from a confirmation link (`linkToken`) asks for it.
   */
  function enterEmailConfirmationPendingState({
    emailAddress = "",
    message = "",
    confirmationUrl: url = "",
    password: typedPassword = "",
    linkToken = ""
  } = {}) {
    switchMode(EMAIL_CONFIRMATION_MODE);
    pendingEmailConfirmationAddress.value = normalizeEmailAddress(emailAddress);
    pendingEmailConfirmationMessage.value = String(message || "").trim();
    confirmationUrl.value = String(url || "").trim();
    password.value = String(typedPassword || "");
    confirmationLinkToken.value = String(linkToken || "").trim();
  }

  function goToMainScreen() {
    window.location.assign(mainScreenPath.value);
  }

  return {
    mode,
    email,
    password,
    confirmPassword,
    otpCode,
    setupCode,
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
    authCapabilities,
    oauthProviders,
    oauthDefaultProvider,
    loading,
    otpRequestPending,
    registerConfirmationResendPending,
    registrationConfirmPending,
    errorMessage,
    infoMessage,
    pendingEmailConfirmationMessage,
    pendingEmailConfirmationAddress,
    confirmationUrl,
    confirmationCode,
    confirmationLinkToken,
    invitationToken,
    isLogin,
    isRegister,
    isForgot,
    isOtp,
    isEmailConfirmationPending,
    canUsePasswordLogin,
    canRegister,
    canRequestPasswordRecovery,
    canUseOtp,
    canUseOAuth,
    canResendEmailConfirmation,
    canEnterConfirmationCode,
    needsFirstAccountSetupCode,
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
    applyCapabilities,
    clearTransientMessages,
    switchMode,
    switchAccount,
    enterEmailConfirmationPendingState,
    goToMainScreen
  };
}
