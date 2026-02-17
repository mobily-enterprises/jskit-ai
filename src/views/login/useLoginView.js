import { computed, onMounted, reactive, ref } from "vue";
import { useNavigate } from "@tanstack/vue-router";
import { useMutation } from "@tanstack/vue-query";
import { resolveSurfacePaths } from "../../../shared/routing/surfacePaths.js";
import { api } from "../../services/api";
import { useAuthStore } from "../../stores/authStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  AUTH_OAUTH_PROVIDER_METADATA,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider
} from "../../../shared/auth/oauthProviders.js";
import { validators } from "../../../shared/auth/validators.js";
import { normalizeEmail } from "../../../shared/auth/utils.js";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation,
  writePendingOAuthContext
} from "../../utils/oauthCallback.js";

const REMEMBERED_ACCOUNT_STORAGE_KEY = "auth.rememberedAccount";

function hasRecoveryLinkPayload() {
  if (typeof window === "undefined") {
    return false;
  }

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const type = String(search.get("type") || hash.get("type") || "")
    .trim()
    .toLowerCase();

  return type === "recovery";
}

function isLocalStorageAvailable() {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    const key = "__auth_hint_probe__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function maskEmail(emailAddress) {
  const normalized = normalizeEmail(emailAddress);
  const separatorIndex = normalized.indexOf("@");
  if (separatorIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domainPart = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  return `${visiblePrefix}***@${domainPart}`;
}

function createRememberedAccountHint({ email: accountEmail, displayName, maskedEmail: accountMaskedEmail, lastUsedAt }) {
  const normalizedEmail = normalizeEmail(accountEmail);
  const normalizedDisplayName = String(displayName || "").trim() || normalizedEmail.split("@")[0] || "User";
  if (!normalizedDisplayName) {
    return null;
  }

  const normalizedLastUsedAt = String(lastUsedAt || new Date().toISOString());
  const maskedEmail =
    typeof accountEmail === "string" && accountEmail.includes("@")
      ? maskEmail(accountEmail)
      : String(accountMaskedEmail || "").trim();

  return {
    displayName: normalizedDisplayName,
    maskedEmail,
    lastUsedAt: normalizedLastUsedAt
  };
}

function toErrorMessage(error, fallback) {
  if (error?.fieldErrors && typeof error.fieldErrors === "object") {
    const details = Array.from(
      new Set(
        Object.values(error.fieldErrors)
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    );
    if (details.length > 0) {
      return details.join(" ");
    }
  }

  return String(error?.message || fallback);
}

export function useLoginView() {
  const navigate = useNavigate();
  const surfacePaths = computed(() =>
    resolveSurfacePaths(typeof window !== "undefined" ? window.location.pathname : "/")
  );
  const authStore = useAuthStore();
  const workspaceStore = useWorkspaceStore();

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

  const isLogin = computed(() => mode.value === "login");
  const isRegister = computed(() => mode.value === "register");
  const isForgot = computed(() => mode.value === "forgot");
  const isOtp = computed(() => mode.value === "otp");
  const showRememberedAccount = computed(
    () => (isLogin.value || isOtp.value) && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));
  const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
  const rememberedAccountSwitchLabel = computed(() => {
    const shortName = String(rememberedAccount.value?.displayName || "").trim();
    return shortName ? `Not ${shortName}?` : "Use another account";
  });
  const oauthProviders = AUTH_OAUTH_PROVIDERS.map((providerId) => AUTH_OAUTH_PROVIDER_METADATA[providerId]).filter(Boolean);

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

  const authTitle = computed(() => {
    if (isRegister.value) {
      return "Register to continue";
    }
    if (isForgot.value) {
      return "Reset your password";
    }
    if (isOtp.value) {
      return "Sign in with one-time code";
    }
    return "Sign in";
  });

  const authSubtitle = computed(() => {
    if (isRegister.value) {
      return "Create a new account to access calculations.";
    }
    if (isForgot.value) {
      return "Enter your email and we will send you a secure password reset link.";
    }
    if (isOtp.value) {
      return "Send a one-time login code to your email, then enter it here.";
    }
    return "";
  });

  const submitLabel = computed(() => {
    if (isRegister.value) {
      return "Create account";
    }
    if (isForgot.value) {
      return "Send reset link";
    }
    if (isOtp.value) {
      return "Verify code";
    }
    return "Sign in";
  });

  function redirectRecoveryLinkToResetPage() {
    if (!hasRecoveryLinkPayload()) {
      return false;
    }

    if (typeof window !== "undefined") {
      window.location.replace(
        `${surfacePaths.value.resetPasswordPath}${window.location.search || ""}${window.location.hash || ""}`
      );
    }

    return true;
  }

  function readOtpLoginCallbackStateFromLocation() {
    if (typeof window === "undefined") {
      return null;
    }

    const search = new URLSearchParams(window.location.search || "");
    const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
    const tokenHash = String(search.get("token_hash") || hash.get("token_hash") || "").trim();
    const type = String(search.get("type") || hash.get("type") || "")
      .trim()
      .toLowerCase();
    const errorCode = String(search.get("error") || hash.get("error") || "").trim();
    const errorDescription = String(search.get("error_description") || hash.get("error_description") || "").trim();
    const hasOtpHint = Boolean(tokenHash) || type === "email";

    if (!hasOtpHint || (!tokenHash && !errorCode)) {
      return null;
    }

    return {
      tokenHash,
      type: type || "email",
      errorCode,
      errorDescription
    };
  }

  function stripOtpLoginCallbackParamsFromLocation() {
    if (typeof window === "undefined") {
      return;
    }

    const url = new URL(window.location.href);
    const search = new URLSearchParams(url.search);
    const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));

    const keysToStrip = ["token_hash", "type", "error", "error_description", "expires_at", "expires_in", "token"];
    for (const key of keysToStrip) {
      search.delete(key);
      hash.delete(key);
    }

    const nextSearch = search.toString();
    const nextHash = hash.toString();
    const nextPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
    window.history.replaceState({}, "", nextPath || "/");
  }

  function resetValidationState() {
    emailTouched.value = false;
    passwordTouched.value = false;
    confirmPasswordTouched.value = false;
    otpCodeTouched.value = false;
    submitAttempted.value = false;
  }

  function readRememberedAccountHint() {
    if (!isLocalStorageAvailable()) {
      return null;
    }

    try {
      const raw = window.localStorage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      return createRememberedAccountHint(parsed);
    } catch {
      return null;
    }
  }

  function writeRememberedAccountHint(hint) {
    if (!isLocalStorageAvailable()) {
      return;
    }

    try {
      window.localStorage.setItem(
        REMEMBERED_ACCOUNT_STORAGE_KEY,
        JSON.stringify({
          displayName: hint.displayName,
          maskedEmail: hint.maskedEmail,
          lastUsedAt: hint.lastUsedAt
        })
      );
    } catch {
      // best effort only
    }
  }

  function clearRememberedAccountHint() {
    if (!isLocalStorageAvailable()) {
      return;
    }

    try {
      window.localStorage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
    } catch {
      // best effort only
    }
  }

  function applyRememberedAccountHint(hint) {
    if (!hint) {
      rememberedAccount.value = null;
      useRememberedAccount.value = false;
      return;
    }

    rememberedAccount.value = hint;
    useRememberedAccount.value = true;
    rememberAccountOnDevice.value = true;
  }

  function applyRememberedAccountPreference({ email: accountEmail, displayName, shouldRemember }) {
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
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
  }

  function switchAccount() {
    clearRememberedAccountHint();
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
    email.value = "";
    password.value = "";
    confirmPassword.value = "";
    otpCode.value = "";
    errorMessage.value = "";
    infoMessage.value = "";
    resetValidationState();
  }

  function switchMode(nextMode) {
    if (nextMode === mode.value) {
      return;
    }

    mode.value = nextMode;
    password.value = "";
    confirmPassword.value = "";
    otpCode.value = "";
    showPassword.value = false;
    showConfirmPassword.value = false;
    errorMessage.value = "";
    infoMessage.value = "";
    resetValidationState();

    if (nextMode !== "login" && nextMode !== "otp") {
      useRememberedAccount.value = false;
      return;
    }

    if (rememberedAccount.value) {
      useRememberedAccount.value = true;
    }
  }

  function oauthProviderButtonLabel(provider) {
    const providerLabel = String(provider?.label || "OAuth provider");
    if (isRegister.value) {
      return `Register with ${providerLabel}`;
    }

    if (showRememberedAccount.value) {
      const displayName = rememberedAccountDisplayName.value;
      return `Continue with ${providerLabel} as ${displayName}`;
    }

    return `Continue with ${providerLabel}`;
  }

  function oauthProviderIcon(provider) {
    if (provider?.id === "google") {
      return "$oauthGoogle";
    }

    return undefined;
  }

  async function startOAuthSignIn(providerId) {
    const provider = normalizeOAuthProvider(providerId, { fallback: null });
    if (!provider) {
      errorMessage.value = "OAuth provider is not supported.";
      return;
    }

    errorMessage.value = "";
    infoMessage.value = "";
    writePendingOAuthContext({
      provider,
      intent: "login",
      returnTo: surfacePaths.value.rootPath,
      rememberAccountOnDevice: rememberAccountOnDevice.value
    });

    if (typeof window !== "undefined") {
      window.location.assign(api.oauthStartUrl(provider, { returnTo: surfacePaths.value.rootPath }));
    }
  }

  async function handleOtpLoginCallbackIfPresent() {
    const callbackState = readOtpLoginCallbackStateFromLocation();
    if (!callbackState) {
      return;
    }

    oauthCallbackInFlight.value = true;
    errorMessage.value = "";
    infoMessage.value = "";

    try {
      if (callbackState.errorCode) {
        const detail = callbackState.errorDescription || callbackState.errorCode;
        throw new Error(`Email login failed: ${detail}`);
      }

      if (!callbackState.tokenHash) {
        throw new Error("Email login callback is missing token information.");
      }

      const response = await otpVerifyMutation.mutateAsync({
        tokenHash: callbackState.tokenHash,
        type: callbackState.type
      });
      const session = await refreshPostAuthContext();

      applyRememberedAccountPreference({
        email: response?.email || "",
        displayName: response?.username || session?.username || "User",
        shouldRemember: true
      });

      stripOtpLoginCallbackParamsFromLocation();
      await navigate({ to: surfacePaths.value.rootPath, replace: true });
    } catch (error) {
      errorMessage.value = toErrorMessage(error, "Unable to complete email one-time login.");
      stripOtpLoginCallbackParamsFromLocation();
    } finally {
      oauthCallbackInFlight.value = false;
    }
  }

  async function handleOAuthCallbackIfPresent() {
    const pendingOAuthContext = readPendingOAuthContext();
    const callbackState = readOAuthCallbackStateFromLocation({
      pendingContext: pendingOAuthContext,
      defaultIntent: "login",
      defaultReturnTo: surfacePaths.value.rootPath
    });

    if (!callbackState) {
      return;
    }

    oauthCallbackInFlight.value = true;
    errorMessage.value = "";
    infoMessage.value = "";

    try {
      const response = await api.oauthComplete(callbackState.payload);
      const session = await refreshPostAuthContext();

      if (callbackState.intent !== "link") {
        const shouldRememberAccount = pendingOAuthContext?.rememberAccountOnDevice !== false;
        applyRememberedAccountPreference({
          email: response?.email || "",
          displayName: response?.username || session?.username || "User",
          shouldRemember: shouldRememberAccount
        });
      }

      stripOAuthCallbackParamsFromLocation();
      await navigate({ to: callbackState.returnTo || surfacePaths.value.rootPath, replace: true });
    } catch (error) {
      errorMessage.value = toErrorMessage(error, "Unable to complete OAuth sign-in.");
      stripOAuthCallbackParamsFromLocation();
    } finally {
      clearPendingOAuthContext();
      oauthCallbackInFlight.value = false;
    }
  }

  const emailError = computed(() => {
    return validators.email(email.value);
  });

  const passwordError = computed(() => {
    if (isForgot.value || isOtp.value) {
      return "";
    }

    if (isRegister.value) {
      return validators.registerPassword(password.value);
    }

    return validators.loginPassword(password.value);
  });

  const confirmPasswordError = computed(() => {
    if (!isRegister.value) {
      return "";
    }

    return validators.confirmPassword({
      password: password.value,
      confirmPassword: confirmPassword.value
    });
  });

  const otpCodeError = computed(() => {
    if (!isOtp.value) {
      return "";
    }

    const token = String(otpCode.value || "").trim();
    if (!token) {
      return "One-time code is required.";
    }
    if (token.length > 2048) {
      return "One-time code is too long.";
    }

    return "";
  });

  const emailErrorMessages = computed(() => {
    if (!submitAttempted.value && !emailTouched.value) {
      return [];
    }
    return emailError.value ? [emailError.value] : [];
  });

  const passwordErrorMessages = computed(() => {
    if (isForgot.value || isOtp.value || (!submitAttempted.value && !passwordTouched.value)) {
      return [];
    }
    return passwordError.value ? [passwordError.value] : [];
  });

  const confirmPasswordErrorMessages = computed(() => {
    if (!isRegister.value || (!submitAttempted.value && !confirmPasswordTouched.value)) {
      return [];
    }
    return confirmPasswordError.value ? [confirmPasswordError.value] : [];
  });

  const otpCodeErrorMessages = computed(() => {
    if (!isOtp.value || (!submitAttempted.value && !otpCodeTouched.value)) {
      return [];
    }
    return otpCodeError.value ? [otpCodeError.value] : [];
  });

  const canSubmit = computed(() => {
    if (loading.value) {
      return false;
    }

    if (emailError.value) {
      return false;
    }

    if (!isForgot.value && !isOtp.value && passwordError.value) {
      return false;
    }

    if (isRegister.value && confirmPasswordError.value) {
      return false;
    }

    if (isOtp.value && otpCodeError.value) {
      return false;
    }

    return true;
  });

  async function requestOtpCode() {
    submitAttempted.value = true;
    errorMessage.value = "";
    infoMessage.value = "";

    const cleanEmail = normalizeEmail(email.value);
    if (validators.email(cleanEmail)) {
      return;
    }

    try {
      const response = await otpRequestMutation.mutateAsync({
        email: cleanEmail
      });
      infoMessage.value = String(
        response?.message || "If an account exists for that email, a one-time code has been sent."
      );
    } catch (error) {
      errorMessage.value = toErrorMessage(error, "Unable to send one-time code.");
    }
  }

  async function submitAuth() {
    submitAttempted.value = true;
    errorMessage.value = "";
    infoMessage.value = "";

    const cleanEmail = normalizeEmail(email.value);
    if (!canSubmit.value) {
      return;
    }

    try {
      if (isForgot.value) {
        const response = await forgotPasswordMutation.mutateAsync({
          email: cleanEmail
        });
        switchMode("login");
        email.value = cleanEmail;
        infoMessage.value = String(
          response?.message || "If an account exists for that email, a password reset link has been sent."
        );
        return;
      }

      if (isRegister.value) {
        const registerResponse = await registerMutation.mutateAsync({ email: cleanEmail, password: password.value });
        if (registerResponse.requiresEmailConfirmation) {
          switchMode("login");
          email.value = cleanEmail;
          infoMessage.value = "Registration accepted. Confirm your email, then sign in.";
          return;
        }
      } else if (isOtp.value) {
        await otpVerifyMutation.mutateAsync({
          email: cleanEmail,
          token: String(otpCode.value || "").trim()
        });
      } else {
        await loginMutation.mutateAsync({ email: cleanEmail, password: password.value });
      }

      const session = await refreshPostAuthContext();

      applyRememberedAccountPreference({
        email: cleanEmail,
        displayName: session?.username || cleanEmail.split("@")[0] || "User",
        shouldRemember: rememberAccountOnDevice.value
      });

      await navigate({ to: surfacePaths.value.rootPath, replace: true });
    } catch (error) {
      errorMessage.value = toErrorMessage(error, "Unable to complete authentication.");
    }
  }

  async function refreshPostAuthContext() {
    const bootstrapPayload = await api.bootstrap();
    const session =
      bootstrapPayload?.session && typeof bootstrapPayload.session === "object" ? bootstrapPayload.session : null;
    if (!session?.authenticated) {
      throw new Error("Login succeeded but the session is not active yet. Please retry.");
    }

    authStore.applySession({
      authenticated: true,
      username: session.username || null
    });
    workspaceStore.applyBootstrap(bootstrapPayload);
    return session;
  }

  onMounted(async () => {
    if (redirectRecoveryLinkToResetPage()) {
      return;
    }

    applyRememberedAccountHint(readRememberedAccountHint());
    await handleOtpLoginCallbackIfPresent();
    await handleOAuthCallbackIfPresent();
  });

  return {
    meta: {
      oauthProviders
    },
    state: reactive({
      authTitle,
      authSubtitle,
      isLogin,
      isRegister,
      isForgot,
      isOtp,
      showRememberedAccount,
      rememberedAccountDisplayName,
      rememberedAccountMaskedEmail,
      rememberedAccountSwitchLabel,
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
      rememberAccountOnDevice,
      emailErrorMessages,
      passwordErrorMessages,
      confirmPasswordErrorMessages,
      otpCodeErrorMessages,
      otpRequestMutation,
      loading,
      errorMessage,
      infoMessage,
      canSubmit,
      submitLabel
    }),
    actions: {
      switchMode,
      switchAccount,
      requestOtpCode,
      startOAuthSignIn,
      oauthProviderButtonLabel,
      oauthProviderIcon,
      submitAuth
    }
  };
}
