import { computed, onMounted, ref } from "vue";
import { useQueryClient } from "@tanstack/vue-query";
import { mdiGoogle } from "@mdi/js";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { AUTH_PATHS, buildAuthOauthStartPath } from "@jskit-ai/auth-core/shared/authPaths";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { authHttpRequest } from "../runtime/authHttpClient.js";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";

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

function validateCommandSection(commandResource, section, payload) {
  if (!commandResource || !commandResource.operation) {
    return {
      ok: true,
      fieldErrors: {},
      globalErrors: []
    };
  }

  return validateOperationSection({
    operation: commandResource.operation,
    section,
    value: payload
  });
}

function resolveValidationMessage(validationResult, fallbackMessage = "Validation failed.") {
  if (!validationResult || validationResult.ok) {
    return "";
  }

  const fieldErrors = validationResult.fieldErrors && typeof validationResult.fieldErrors === "object"
    ? validationResult.fieldErrors
    : {};
  const firstFieldError = Object.values(fieldErrors).find((entry) => String(entry || "").trim().length > 0);
  if (firstFieldError) {
    return String(firstFieldError);
  }

  const globalErrors = Array.isArray(validationResult.globalErrors) ? validationResult.globalErrors : [];
  const firstGlobalError = globalErrors.find((entry) => String(entry || "").trim().length > 0);
  if (firstGlobalError) {
    return String(firstGlobalError);
  }

  return String(fallbackMessage || "Validation failed.");
}

export function useDefaultLoginView() {
  const queryClient = useQueryClient();
  const errorRuntime = useShellWebErrorRuntime();
  const sessionQueryKey = Object.freeze(["auth-web", "session"]);
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

    const normalizedEmail = String(email.value || "").trim().toLowerCase();
    const command = isRegister.value
      ? authRegisterCommand
      : isForgot.value
        ? authPasswordResetRequestCommand
        : isOtp.value
          ? authLoginOtpRequestCommand
          : authLoginPasswordCommand;
    const payload = isRegister.value || isLogin.value
      ? {
          email: normalizedEmail,
          password: String(password.value || "")
        }
      : {
          email: normalizedEmail
        };
    const parsed = validateCommandSection(command, "bodyValidator", payload);
    const message = parsed.fieldErrors?.email;
    if (message) {
      return [String(message)];
    }
    return [];
  });

  const passwordErrorMessages = computed(() => {
    const shouldValidate = submitAttempted.value || passwordTouched.value;
    if (!shouldValidate || isForgot.value || isOtp.value) {
      return [];
    }

    const normalizedEmail = String(email.value || "").trim().toLowerCase();
    const command = isRegister.value ? authRegisterCommand : authLoginPasswordCommand;
    const parsed = validateCommandSection(command, "bodyValidator", {
      email: normalizedEmail,
      password: String(password.value || "")
    });
    const message = parsed.fieldErrors?.password;
    if (message) {
      return [String(message)];
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

    const parsed = validateCommandSection(authLoginOtpVerifyCommand, "bodyValidator", {
      token: String(otpCode.value || "").trim()
    });
    const message = parsed.fieldErrors?.token;
    if (message) {
      return [String(message)];
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
    normalizeAuthReturnToPath(
      typeof window === "object" ? new URLSearchParams(window.location.search || "").get("returnTo") : "/",
      "/"
    )
  );

  function reportAuthFeedback({
    message,
    severity = "error",
    channel = "banner",
    dedupeKey = ""
  } = {}) {
    const normalizedMessage = String(message || "").trim();
    if (!normalizedMessage) {
      return;
    }

    errorRuntime.report({
      source: "auth-web.default-login-view",
      message: normalizedMessage,
      severity,
      channel,
      dedupeKey: dedupeKey || `auth-web.default-login-view:${severity}:${normalizedMessage}`,
      dedupeWindowMs: 3000
    });
  }

  function setErrorMessage(message, dedupeKey = "") {
    const normalizedMessage = String(message || "").trim();
    errorMessage.value = normalizedMessage;
    if (!normalizedMessage) {
      return;
    }

    reportAuthFeedback({
      message: normalizedMessage,
      severity: "error",
      channel: "banner",
      dedupeKey
    });
  }

  function setInfoMessage(message, dedupeKey = "") {
    const normalizedMessage = String(message || "").trim();
    infoMessage.value = normalizedMessage;
    if (!normalizedMessage) {
      return;
    }

    reportAuthFeedback({
      message: normalizedMessage,
      severity: "info",
      channel: "snackbar",
      dedupeKey
    });
  }

  function clearTransientMessages() {
    setErrorMessage("");
    setInfoMessage("");
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
    const session = await queryClient.fetchQuery({
      queryKey: sessionQueryKey,
      queryFn: () => request(AUTH_PATHS.SESSION),
      staleTime: 0
    });
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

    requestedReturnTo.value = normalizeAuthReturnToPath(callbackParams.returnTo, requestedReturnTo.value);

    const provider = String(callbackParams.provider || resolveDefaultOAuthProvider() || "")
      .trim()
      .toLowerCase();
    const oauthError = callbackParams.errorCode;
    const oauthErrorDescription = callbackParams.errorDescription;

    if (!provider) {
      setErrorMessage("OAuth provider is missing from callback.", "auth-web.default-login-view:oauth-missing-provider");
      stripOAuthParamsFromLocation();
      return true;
    }

    if (oauthError) {
      setErrorMessage(oauthErrorDescription || oauthError, "auth-web.default-login-view:oauth-callback-error");
      stripOAuthParamsFromLocation();
      return true;
    }

    loading.value = true;
    setErrorMessage("");
    setInfoMessage("");

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

      const parsedPayload = validateCommandSection(authLoginOAuthCompleteCommand, "bodyValidator", payload);
      if (!parsedPayload.ok) {
        throw new Error(resolveValidationMessage(parsedPayload, "Invalid OAuth callback payload."));
      }

      const oauthResult = await request(AUTH_PATHS.OAUTH_COMPLETE, {
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
      setErrorMessage(String(error?.message || "Unable to complete OAuth sign-in."));
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
        const registerPayload = {
          email: normalizedEmail,
          password: String(password.value || "")
        };
        const parsedRegister = validateCommandSection(authRegisterCommand, "bodyValidator", registerPayload);
        if (!parsedRegister.ok) {
          throw new Error(resolveValidationMessage(parsedRegister, "Unable to register."));
        }

        const registerResult = await request(AUTH_PATHS.REGISTER, {
          method: "POST",
          body: registerPayload
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
        const forgotPayload = { email: normalizedEmail };
        const parsedForgot = validateCommandSection(authPasswordResetRequestCommand, "bodyValidator", forgotPayload);
        if (!parsedForgot.ok) {
          throw new Error(resolveValidationMessage(parsedForgot, "Unable to request password reset."));
        }

        await request(AUTH_PATHS.PASSWORD_FORGOT, {
          method: "POST",
          body: forgotPayload
        });
        setInfoMessage("Password reset instructions sent.", "auth-web.default-login-view:password-reset-sent");
        return;
      }

      if (isOtp.value) {
        const otpPayload = {
          email: normalizedEmail,
          token: String(otpCode.value || "").trim(),
          type: "email"
        };
        const parsedOtp = validateCommandSection(authLoginOtpVerifyCommand, "bodyValidator", otpPayload);
        if (!parsedOtp.ok) {
          throw new Error(resolveValidationMessage(parsedOtp, "Unable to verify one-time code."));
        }

        const otpResult = await request(AUTH_PATHS.LOGIN_OTP_VERIFY, {
          method: "POST",
          body: otpPayload
        });
        applyRememberedAccountPreference({
          email: normalizedEmail,
          displayName: otpResult?.username || normalizedEmail,
          shouldRemember: shouldRememberAccount
        });
        await completeLogin();
        return;
      }

      const loginPayload = {
        email: normalizedEmail,
        password: String(password.value || "")
      };
      const parsedLogin = validateCommandSection(authLoginPasswordCommand, "bodyValidator", loginPayload);
      if (!parsedLogin.ok) {
        throw new Error(resolveValidationMessage(parsedLogin, "Unable to sign in."));
      }

      const loginResult = await request(AUTH_PATHS.LOGIN, {
        method: "POST",
        body: loginPayload
      });
      applyRememberedAccountPreference({
        email: normalizedEmail,
        displayName: loginResult?.username || normalizedEmail,
        shouldRemember: shouldRememberAccount
      });
      await completeLogin();
    } catch (error) {
      setErrorMessage(String(error?.message || "Authentication failed."));
    } finally {
      loading.value = false;
    }
  }

  async function requestOtpCode() {
    otpRequestPending.value = true;
    setErrorMessage("");
    setInfoMessage("");
    try {
      const normalizedEmail = String(email.value || "").trim().toLowerCase();
      const otpRequestPayload = {
        email: normalizedEmail,
        returnTo: requestedReturnTo.value
      };
      const parsedRequest = validateCommandSection(authLoginOtpRequestCommand, "bodyValidator", otpRequestPayload);
      if (!parsedRequest.ok) {
        throw new Error(resolveValidationMessage(parsedRequest, "Unable to request one-time code."));
      }
      await request(AUTH_PATHS.LOGIN_OTP_REQUEST, {
        method: "POST",
        body: otpRequestPayload
      });
      setInfoMessage("One-time code sent. Check your inbox.", "auth-web.default-login-view:otp-code-sent");
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to request one-time code."));
    } finally {
      otpRequestPending.value = false;
    }
  }

  function startOAuthSignIn(providerId) {
    const provider = String(providerId || "").trim().toLowerCase();
    if (!provider || typeof window !== "object" || !window.location) {
      return;
    }

    const paramsPayload = {
      provider
    };
    const queryPayload = {
      returnTo: requestedReturnTo.value
    };
    const parsedParams = validateCommandSection(authLoginOAuthStartCommand, "paramsValidator", paramsPayload);
    if (!parsedParams.ok) {
      setErrorMessage(resolveValidationMessage(parsedParams, "OAuth provider id is invalid."));
      return;
    }
    const parsedQuery = validateCommandSection(authLoginOAuthStartCommand, "queryValidator", queryPayload);
    if (!parsedQuery.ok) {
      setErrorMessage(resolveValidationMessage(parsedQuery, "OAuth return path is invalid."));
      return;
    }

    const params = new URLSearchParams(queryPayload);
    const oauthStartPath = buildAuthOauthStartPath(provider);
    window.location.assign(`${oauthStartPath}?${params.toString()}`);
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
      setErrorMessage(String(error?.message || "Unable to initialize sign in."));
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
