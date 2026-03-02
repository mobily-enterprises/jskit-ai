import { computed, onMounted, ref } from "vue";
import { mdiGoogle } from "@mdi/js";
import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/access-core/server/oauthCallbackParams";
import { authHttpRequest } from "../runtime/authHttpClient.js";

const REMEMBERED_ACCOUNT_STORAGE_KEY = "auth.rememberedAccount";

function normalizeEmailAddress(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function maskEmail(emailAddress) {
  const normalized = normalizeEmailAddress(emailAddress);
  const separatorIndex = normalized.indexOf("@");
  if (separatorIndex <= 0) {
    return normalized;
  }

  const localPart = normalized.slice(0, separatorIndex);
  const domainPart = normalized.slice(separatorIndex + 1);
  const visiblePrefix = localPart.slice(0, 1);
  return `${visiblePrefix}***@${domainPart}`;
}

function resolveLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const probeKey = "__auth_hint_probe__";
    window.localStorage.setItem(probeKey, "1");
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return null;
  }
}

function createRememberedAccountHint({ email: accountEmail, displayName, maskedEmail, lastUsedAt } = {}) {
  const normalizedEmail = normalizeEmailAddress(accountEmail);
  if (!normalizedEmail) {
    return null;
  }

  const normalizedDisplayName = String(displayName || "").trim() || normalizedEmail.split("@")[0] || "User";
  const normalizedMaskedEmail =
    normalizedEmail.includes("@") && !maskedEmail ? maskEmail(normalizedEmail) : String(maskedEmail || "").trim();

  return {
    email: normalizedEmail,
    displayName: normalizedDisplayName,
    maskedEmail: normalizedMaskedEmail,
    lastUsedAt: String(lastUsedAt || new Date().toISOString())
  };
}

function readRememberedAccountHint() {
  const storage = resolveLocalStorage();
  if (!storage) {
    return null;
  }

  try {
    const rawValue = storage.getItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }
    const parsed = JSON.parse(rawValue);
    return createRememberedAccountHint(parsed);
  } catch {
    return null;
  }
}

function writeRememberedAccountHint(hint) {
  const storage = resolveLocalStorage();
  if (!storage || !hint) {
    return;
  }

  try {
    storage.setItem(
      REMEMBERED_ACCOUNT_STORAGE_KEY,
      JSON.stringify({
        email: hint.email,
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
  const storage = resolveLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(REMEMBERED_ACCOUNT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

function normalizeReturnToPath(value, fallback = "/app") {
  const raw = String(value || "").trim();
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw === "/auth/login" ||
    raw.startsWith("/auth/login?") ||
    raw === "/auth/signout" ||
    raw.startsWith("/auth/signout?")
  ) {
    return fallback;
  }
  return raw;
}

function stripOAuthParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  const oauthParamKeys = [
    "code",
    "access_token",
    "refresh_token",
    "provider_token",
    "expires_in",
    "expires_at",
    "token_type",
    "state",
    "sb",
    "type",
    "error",
    "error_description",
    "errorCode",
    "errorDescription",
    OAUTH_QUERY_PARAM_PROVIDER,
    OAUTH_QUERY_PARAM_RETURN_TO
  ];

  oauthParamKeys.forEach((key) => {
    nextUrl.searchParams.delete(key);
  });

  const hashParams = new URLSearchParams((nextUrl.hash || "").replace(/^#/, ""));
  oauthParamKeys.forEach((key) => {
    hashParams.delete(key);
  });

  const nextHash = hashParams.toString();
  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextHash ? `#${nextHash}` : ""}`);
}

function readOAuthCallbackParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search || "");
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

  const code = String(searchParams.get("code") || hashParams.get("code") || "").trim();
  const accessToken = String(searchParams.get("access_token") || hashParams.get("access_token") || "").trim();
  const refreshToken = String(searchParams.get("refresh_token") || hashParams.get("refresh_token") || "").trim();
  const errorCode = String(
    searchParams.get("error") ||
      hashParams.get("error") ||
      searchParams.get("errorCode") ||
      hashParams.get("errorCode") ||
      ""
  ).trim();
  const errorDescription = String(
    searchParams.get("error_description") ||
      hashParams.get("error_description") ||
      searchParams.get("errorDescription") ||
      hashParams.get("errorDescription") ||
      ""
  ).trim();
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !hasSessionPair && !errorCode) {
    return null;
  }

  return {
    code,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    provider: String(searchParams.get(OAUTH_QUERY_PARAM_PROVIDER) || "").trim().toLowerCase(),
    returnTo: String(searchParams.get(OAUTH_QUERY_PARAM_RETURN_TO) || "").trim()
  };
}

export function useDefaultLoginView() {
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
  const rememberAccountOnDevice = ref(true);
  const rememberedAccount = ref(null);
  const useRememberedAccount = ref(false);
  const oauthProviders = ref([]);
  const oauthDefaultProvider = ref("");
  const loading = ref(false);
  const otpRequestPending = ref(false);
  const errorMessage = ref("");
  const infoMessage = ref("");

  const isLogin = computed(() => mode.value === "login");
  const isRegister = computed(() => mode.value === "register");
  const isForgot = computed(() => mode.value === "forgot");
  const isOtp = computed(() => mode.value === "otp");
  const showRememberedAccount = computed(
    () => (isLogin.value || isOtp.value) && useRememberedAccount.value && Boolean(rememberedAccount.value)
  );
  const rememberedAccountDisplayName = computed(() => String(rememberedAccount.value?.displayName || "your account"));
  const rememberedAccountMaskedEmail = computed(() => String(rememberedAccount.value?.maskedEmail || ""));
  const rememberedAccountSwitchLabel = computed(() => "Use another account");

  const authTitle = computed(() => {
    if (isRegister.value) {
      return "Create your account";
    }
    if (isForgot.value) {
      return "Reset your password";
    }
    if (isOtp.value) {
      return "Use one-time code";
    }
    return "Welcome back";
  });

  const authSubtitle = computed(() => {
    if (isRegister.value) {
      return "Register to access your workspace.";
    }
    if (isForgot.value) {
      return "We will send password reset instructions to your email.";
    }
    if (isOtp.value) {
      return "Request a one-time login code and verify it below.";
    }
    return "Sign in to continue.";
  });

  const submitLabel = computed(() => {
    if (isRegister.value) {
      return "Register";
    }
    if (isForgot.value) {
      return "Send reset instructions";
    }
    if (isOtp.value) {
      return "Verify code";
    }
    return "Sign in";
  });

  const emailErrorMessages = computed(() => {
    const shouldValidate = submitAttempted.value || emailTouched.value;
    if (!shouldValidate) {
      return [];
    }

    const value = String(email.value || "").trim();
    if (!value) {
      return ["Email is required."];
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return ["Enter a valid email address."];
    }
    return [];
  });

  const passwordErrorMessages = computed(() => {
    const shouldValidate = submitAttempted.value || passwordTouched.value;
    if (!shouldValidate || isForgot.value || isOtp.value) {
      return [];
    }
    if (!String(password.value || "").trim()) {
      return ["Password is required."];
    }
    if (isRegister.value && String(password.value || "").trim().length < 8) {
      return ["Password must be at least 8 characters."];
    }
    return [];
  });

  const confirmPasswordErrorMessages = computed(() => {
    const shouldValidate = submitAttempted.value || confirmPasswordTouched.value;
    if (!shouldValidate || !isRegister.value) {
      return [];
    }
    if (String(confirmPassword.value || "").trim() !== String(password.value || "").trim()) {
      return ["Passwords do not match."];
    }
    return [];
  });

  const otpCodeErrorMessages = computed(() => {
    const shouldValidate = submitAttempted.value || otpCodeTouched.value;
    if (!shouldValidate || !isOtp.value) {
      return [];
    }
    if (!String(otpCode.value || "").trim()) {
      return ["One-time code is required."];
    }
    return [];
  });

  const canSubmit = computed(() => {
    if (loading.value) {
      return false;
    }

    if (emailErrorMessages.value.length > 0) {
      return false;
    }

    if (isRegister.value || isLogin.value) {
      return passwordErrorMessages.value.length < 1 && confirmPasswordErrorMessages.value.length < 1;
    }
    if (isOtp.value) {
      return otpCodeErrorMessages.value.length < 1;
    }
    return true;
  });

  const requestedReturnTo = ref(
    normalizeReturnToPath(
      typeof window === "object" ? new URLSearchParams(window.location.search || "").get("returnTo") : "/app",
      "/app"
    )
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

  function applyRememberedAccountHint(hint) {
    if (!hint) {
      rememberedAccount.value = null;
      useRememberedAccount.value = false;
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
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
  }

  function switchAccount() {
    clearRememberedAccountHint();
    rememberedAccount.value = null;
    useRememberedAccount.value = false;
    rememberAccountOnDevice.value = false;
    mode.value = "login";
    email.value = "";
    password.value = "";
    confirmPassword.value = "";
    otpCode.value = "";
    showPassword.value = false;
    showConfirmPassword.value = false;
    clearTransientMessages();
    resetTransientValidationState();
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
    clearTransientMessages();
    resetTransientValidationState();

    if (nextMode !== "login" && nextMode !== "otp") {
      useRememberedAccount.value = false;
      return;
    }

    if (rememberedAccount.value) {
      useRememberedAccount.value = true;
    }
  }

  function oauthProviderButtonLabel(provider) {
    const providerLabel = String(provider?.label || provider?.id || "OAuth provider");
    if (isRegister.value) {
      return `Register with ${providerLabel}`;
    }
    if (showRememberedAccount.value) {
      return `Continue with ${providerLabel} as ${rememberedAccountDisplayName.value}`;
    }
    return `Continue with ${providerLabel}`;
  }

  function oauthProviderIcon(provider) {
    if (String(provider?.id || "").toLowerCase() === "google") {
      return mdiGoogle;
    }
    return undefined;
  }

  async function request(path, options = {}) {
    return authHttpRequest(path, {
      method: options.method || "GET",
      ...(options.body ? { body: options.body } : {})
    });
  }

  function applySessionPayload(payload) {
    oauthProviders.value = Array.isArray(payload?.oauthProviders)
      ? payload.oauthProviders
          .map((provider) => {
            if (!provider || typeof provider !== "object") {
              return null;
            }
            const id = String(provider.id || "")
              .trim()
              .toLowerCase();
            if (!id) {
              return null;
            }
            return {
              id,
              label: String(provider.label || id).trim() || id
            };
          })
          .filter(Boolean)
      : [];

    oauthDefaultProvider.value = String(payload?.oauthDefaultProvider || "")
      .trim()
      .toLowerCase();
  }

  function resolveDefaultOAuthProvider() {
    const explicit = oauthDefaultProvider.value;
    if (explicit) {
      return explicit;
    }
    return String(oauthProviders.value[0]?.id || "")
      .trim()
      .toLowerCase();
  }

  async function refreshSession() {
    const session = await request("/api/session");
    applySessionPayload(session);
    return session;
  }

  async function completeLogin() {
    const session = await refreshSession();
    if (!session?.authenticated) {
      throw new Error("Login succeeded but the session is not active yet. Please retry.");
    }
    if (typeof window === "object" && window.location) {
      window.location.replace(requestedReturnTo.value);
    }
  }

  async function handleOAuthCallbackIfPresent() {
    const callbackParams = readOAuthCallbackParamsFromLocation();
    if (!callbackParams) {
      return false;
    }

    requestedReturnTo.value = normalizeReturnToPath(callbackParams.returnTo, requestedReturnTo.value);

    const provider = String(callbackParams.provider || resolveDefaultOAuthProvider() || "")
      .trim()
      .toLowerCase();
    const oauthError = callbackParams.errorCode;
    const oauthErrorDescription = callbackParams.errorDescription;

    if (!provider) {
      errorMessage.value = "OAuth provider is missing from callback.";
      stripOAuthParamsFromLocation();
      return true;
    }

    if (oauthError) {
      errorMessage.value = oauthErrorDescription || oauthError;
      stripOAuthParamsFromLocation();
      return true;
    }

    loading.value = true;
    errorMessage.value = "";
    infoMessage.value = "";

    try {
      const payload = {
        provider
      };
      if (callbackParams.code) {
        payload.code = callbackParams.code;
      }
      if (callbackParams.hasSessionPair) {
        payload.accessToken = callbackParams.accessToken;
        payload.refreshToken = callbackParams.refreshToken;
      }

      const oauthResult = await request("/api/oauth/complete", {
        method: "POST",
        body: payload
      });
      applyRememberedAccountPreference({
        email: oauthResult?.email || email.value,
        displayName: oauthResult?.username || oauthResult?.email || email.value,
        shouldRemember: rememberAccountOnDevice.value !== false
      });

      stripOAuthParamsFromLocation();
      await completeLogin();
    } catch (error) {
      errorMessage.value = String(error?.message || "Unable to complete OAuth sign-in.");
      stripOAuthParamsFromLocation();
    } finally {
      loading.value = false;
    }

    return true;
  }

  async function submitAuth() {
    submitAttempted.value = true;
    clearTransientMessages();
    if (!canSubmit.value) {
      return;
    }

    loading.value = true;

    try {
      const normalizedEmail = String(email.value || "").trim().toLowerCase();
      const shouldRememberAccount = rememberAccountOnDevice.value !== false;

      if (isRegister.value) {
        const registerResult = await request("/api/register", {
          method: "POST",
          body: {
            email: normalizedEmail,
            password: String(password.value || "")
          }
        });
        applyRememberedAccountPreference({
          email: normalizedEmail,
          displayName: registerResult?.username || normalizedEmail,
          shouldRemember: shouldRememberAccount
        });
        await completeLogin();
        return;
      }

      if (isForgot.value) {
        await request("/api/password/forgot", {
          method: "POST",
          body: { email: normalizedEmail }
        });
        infoMessage.value = "Password reset instructions sent.";
        return;
      }

      if (isOtp.value) {
        const otpResult = await request("/api/login/otp/verify", {
          method: "POST",
          body: {
            email: normalizedEmail,
            token: String(otpCode.value || "").trim(),
            type: "email"
          }
        });
        applyRememberedAccountPreference({
          email: normalizedEmail,
          displayName: otpResult?.username || normalizedEmail,
          shouldRemember: shouldRememberAccount
        });
        await completeLogin();
        return;
      }

      const loginResult = await request("/api/login", {
        method: "POST",
        body: {
          email: normalizedEmail,
          password: String(password.value || "")
        }
      });
      applyRememberedAccountPreference({
        email: normalizedEmail,
        displayName: loginResult?.username || normalizedEmail,
        shouldRemember: shouldRememberAccount
      });
      await completeLogin();
    } catch (error) {
      errorMessage.value = String(error?.message || "Authentication failed.");
    } finally {
      loading.value = false;
    }
  }

  async function requestOtpCode() {
    otpRequestPending.value = true;
    errorMessage.value = "";
    infoMessage.value = "";
    try {
      const normalizedEmail = String(email.value || "").trim().toLowerCase();
      if (!normalizedEmail) {
        throw new Error("Email is required to request a one-time code.");
      }
      await request("/api/login/otp/request", {
        method: "POST",
        body: {
          email: normalizedEmail,
          returnTo: requestedReturnTo.value
        }
      });
      infoMessage.value = "One-time code sent. Check your inbox.";
    } catch (error) {
      errorMessage.value = String(error?.message || "Unable to request one-time code.");
    } finally {
      otpRequestPending.value = false;
    }
  }

  function startOAuthSignIn(providerId) {
    const provider = String(providerId || "").trim().toLowerCase();
    if (!provider || typeof window !== "object" || !window.location) {
      return;
    }

    const params = new URLSearchParams({
      returnTo: requestedReturnTo.value
    });
    window.location.assign(`/api/oauth/${encodeURIComponent(provider)}/start?${params.toString()}`);
  }

  onMounted(async () => {
    applyRememberedAccountHint(readRememberedAccountHint());
    loading.value = true;
    try {
      const session = await refreshSession();
      const callbackHandled = await handleOAuthCallbackIfPresent();
      if (!callbackHandled && session?.authenticated && typeof window === "object" && window.location) {
        window.location.replace(requestedReturnTo.value);
        return;
      }
    } catch (error) {
      errorMessage.value = String(error?.message || "Unable to initialize sign in.");
    } finally {
      loading.value = false;
    }
  });

  return {
    authTitle,
    authSubtitle,
    isForgot,
    isOtp,
    isLogin,
    isRegister,
    showRememberedAccount,
    switchMode,
    submitAuth,
    rememberedAccountDisplayName,
    rememberedAccountMaskedEmail,
    rememberedAccountSwitchLabel,
    switchAccount,
    email,
    emailErrorMessages,
    emailTouched,
    password,
    showPassword,
    passwordErrorMessages,
    passwordTouched,
    confirmPassword,
    showConfirmPassword,
    confirmPasswordErrorMessages,
    confirmPasswordTouched,
    otpCode,
    otpCodeErrorMessages,
    otpCodeTouched,
    rememberAccountOnDevice,
    otpRequestPending,
    requestOtpCode,
    oauthProviders,
    loading,
    oauthProviderIcon,
    startOAuthSignIn,
    oauthProviderButtonLabel,
    errorMessage,
    infoMessage,
    canSubmit,
    submitLabel
  };
}
