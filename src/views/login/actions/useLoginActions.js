import { normalizeOAuthProvider } from "../../../../shared/auth/oauthProviders.js";
import { validators } from "../../../../shared/auth/validators.js";
import { normalizeEmail } from "../../../../shared/auth/utils.js";
import { api } from "../../../services/api";
import {
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  readPendingOAuthContext,
  stripOAuthCallbackParamsFromLocation,
  writePendingOAuthContext
} from "../../../utils/oauthCallback.js";
import {
  clearRememberedAccountHint,
  readRememberedAccountHint,
  createRememberedAccountHint,
  writeRememberedAccountHint
} from "../remembered-account/loginRememberedAccountStorage";
import { hasRecoveryLinkPayload } from "../recovery/loginRecoveryLink";
import {
  readOtpLoginCallbackStateFromLocation,
  stripOtpLoginCallbackParamsFromLocation
} from "../otp/loginOtpCallbackState";
import { toErrorMessage } from "../shared/loginErrorMessage";

export function useLoginActions({
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
}) {
  function resetValidationState() {
    emailTouched.value = false;
    passwordTouched.value = false;
    confirmPasswordTouched.value = false;
    otpCodeTouched.value = false;
    submitAttempted.value = false;
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

  async function initializeLoginView() {
    if (redirectRecoveryLinkToResetPage()) {
      return;
    }

    applyRememberedAccountHint(readRememberedAccountHint());
    await handleOtpLoginCallbackIfPresent();
    await handleOAuthCallbackIfPresent();
  }

  return {
    switchMode,
    switchAccount,
    requestOtpCode,
    startOAuthSignIn,
    oauthProviderButtonLabel,
    oauthProviderIcon,
    submitAuth,
    initializeLoginView
  };
}
