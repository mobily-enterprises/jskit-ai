import { mdiGoogle } from "@mdi/js";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authRegisterConfirmationResendCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterConfirmationResendCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { AUTH_PATHS, buildAuthOauthStartPath } from "@jskit-ai/auth-core/shared/authPaths";
import { authHttpRequest } from "../../runtime/authHttpClient.js";
import { normalizeAuthReturnToPath } from "../../lib/returnToPath.js";
import { normalizeEmailAddress } from "./identityHelpers.js";
import { readRememberedAccountHint } from "./rememberedAccountStorage.js";
import {
  stripOAuthParamsFromLocation,
  readOAuthCallbackParamsFromLocation
} from "./oauthCallbackUrl.js";
import { ensureCommandSectionValid } from "./validationHelpers.js";
import { resolveRegisterCompletionState } from "./registerCompletion.js";

const SESSION_QUERY_KEY = Object.freeze(["auth-web", "session"]);

export function useLoginViewActions({
  state,
  validation,
  queryClient,
  errorRuntime
} = {}) {
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
    state.errorMessage.value = normalizedMessage;
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
    state.infoMessage.value = normalizedMessage;
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
    state.clearTransientMessages();
  }

  async function request(path, options = {}) {
    return authHttpRequest(path, {
      method: options.method || "GET",
      ...(options.body ? { body: options.body } : {})
    });
  }

  function applySessionPayload(payload) {
    state.oauthProviders.value = Array.isArray(payload?.oauthProviders)
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

    state.oauthDefaultProvider.value = String(payload?.oauthDefaultProvider || "")
      .trim()
      .toLowerCase();
  }

  function resolveDefaultOAuthProvider() {
    const explicit = state.oauthDefaultProvider.value;
    if (explicit) {
      return explicit;
    }
    return String(state.oauthProviders.value[0]?.id || "")
      .trim()
      .toLowerCase();
  }

  async function refreshSession() {
    const session = await queryClient.fetchQuery({
      queryKey: SESSION_QUERY_KEY,
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
      window.location.replace(state.requestedReturnTo.value);
    }
  }

  async function submitRegister({ normalizedEmail, shouldRememberAccount }) {
    const registerPayload = {
      email: normalizedEmail,
      password: String(state.password.value || "")
    };
    ensureCommandSectionValid(authRegisterCommand, "body", registerPayload, "Unable to register.");

    const registerResult = await request(AUTH_PATHS.REGISTER, {
      method: "POST",
      body: registerPayload
    });
    state.applyRememberedAccountPreference({
      email: normalizedEmail,
      displayName: registerResult?.username || normalizedEmail,
      shouldRemember: shouldRememberAccount
    });

    const registerCompletion = resolveRegisterCompletionState(registerResult);
    if (!registerCompletion.shouldCompleteLogin) {
      state.enterEmailConfirmationPendingState({
        emailAddress: normalizedEmail,
        message: registerCompletion.message
      });
      return;
    }

    await completeLogin();
  }

  async function submitForgot({ normalizedEmail }) {
    const forgotPayload = { email: normalizedEmail };
    ensureCommandSectionValid(
      authPasswordResetRequestCommand,
      "body",
      forgotPayload,
      "Unable to request password reset."
    );

    await request(AUTH_PATHS.PASSWORD_FORGOT, {
      method: "POST",
      body: forgotPayload
    });
    setInfoMessage("Password reset instructions sent.", "auth-web.default-login-view:password-reset-sent");
  }

  async function submitOtp({ normalizedEmail, shouldRememberAccount }) {
    const otpPayload = {
      email: normalizedEmail,
      token: String(state.otpCode.value || "").trim(),
      type: "email"
    };
    ensureCommandSectionValid(authLoginOtpVerifyCommand, "body", otpPayload, "Unable to verify one-time code.");

    const otpResult = await request(AUTH_PATHS.LOGIN_OTP_VERIFY, {
      method: "POST",
      body: otpPayload
    });
    state.applyRememberedAccountPreference({
      email: normalizedEmail,
      displayName: otpResult?.username || normalizedEmail,
      shouldRemember: shouldRememberAccount
    });
    await completeLogin();
  }

  async function submitLogin({ normalizedEmail, shouldRememberAccount }) {
    const loginPayload = {
      email: normalizedEmail,
      password: String(state.password.value || "")
    };
    ensureCommandSectionValid(authLoginPasswordCommand, "body", loginPayload, "Unable to sign in.");

    const loginResult = await request(AUTH_PATHS.LOGIN, {
      method: "POST",
      body: loginPayload
    });
    state.applyRememberedAccountPreference({
      email: normalizedEmail,
      displayName: loginResult?.username || normalizedEmail,
      shouldRemember: shouldRememberAccount
    });
    await completeLogin();
  }

  function buildOAuthCompletePayload({ callbackParams, provider, hasSessionPair }) {
    const payload = {};
    if (provider) {
      payload.provider = provider;
    }
    if (callbackParams.code) {
      payload.code = callbackParams.code;
    }
    if (hasSessionPair) {
      payload.accessToken = callbackParams.accessToken;
      payload.refreshToken = callbackParams.refreshToken;
    }
    return payload;
  }

  async function handleOAuthCallbackIfPresent() {
    const callbackParams = readOAuthCallbackParamsFromLocation();
    if (!callbackParams) {
      return false;
    }

    state.requestedReturnTo.value = normalizeAuthReturnToPath(callbackParams.returnTo, state.requestedReturnTo.value, {
      allowedOrigins: state.allowedReturnToOrigins.value
    });

    const provider = String(callbackParams.provider || resolveDefaultOAuthProvider() || "")
      .trim()
      .toLowerCase();
    const oauthError = callbackParams.errorCode;
    const oauthErrorDescription = callbackParams.errorDescription;
    const hasSessionPair = callbackParams.hasSessionPair === true;

    if (!provider && !hasSessionPair) {
      setErrorMessage("OAuth provider is missing from callback.", "auth-web.default-login-view:oauth-missing-provider");
      stripOAuthParamsFromLocation();
      return true;
    }

    if (oauthError) {
      setErrorMessage(oauthErrorDescription || oauthError, "auth-web.default-login-view:oauth-callback-error");
      stripOAuthParamsFromLocation();
      return true;
    }

    state.loading.value = true;
    clearTransientMessages();

    try {
      const payload = buildOAuthCompletePayload({
        callbackParams,
        provider,
        hasSessionPair
      });
      ensureCommandSectionValid(
        authLoginOAuthCompleteCommand,
        "body",
        payload,
        "Invalid OAuth callback payload."
      );

      const oauthResult = await request(AUTH_PATHS.OAUTH_COMPLETE, {
        method: "POST",
        body: payload
      });
      state.applyRememberedAccountPreference({
        email: oauthResult?.email || state.email.value,
        displayName: oauthResult?.username || oauthResult?.email || state.email.value,
        shouldRemember: state.rememberAccountOnDevice.value !== false
      });

      stripOAuthParamsFromLocation();
      await completeLogin();
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to complete OAuth sign-in."));
      stripOAuthParamsFromLocation();
    } finally {
      state.loading.value = false;
    }

    return true;
  }

  async function submitAuth() {
    state.submitAttempted.value = true;
    clearTransientMessages();
    if (!validation.canSubmit.value) {
      return;
    }

    state.loading.value = true;

    try {
      const normalizedEmail = state.resolveNormalizedEmail();
      const shouldRememberAccount = state.rememberAccountOnDevice.value !== false;

      if (state.isRegister.value) {
        await submitRegister({ normalizedEmail, shouldRememberAccount });
        return;
      }

      if (state.isForgot.value) {
        await submitForgot({ normalizedEmail });
        return;
      }

      if (state.isOtp.value) {
        await submitOtp({ normalizedEmail, shouldRememberAccount });
        return;
      }

      await submitLogin({ normalizedEmail, shouldRememberAccount });
    } catch (error) {
      setErrorMessage(String(error?.message || "Authentication failed."));
    } finally {
      state.loading.value = false;
    }
  }

  async function requestOtpCode() {
    state.otpRequestPending.value = true;
    clearTransientMessages();
    try {
      const normalizedEmail = state.resolveNormalizedEmail();
      const otpRequestPayload = {
        email: normalizedEmail,
        returnTo: state.requestedReturnTo.value
      };
      ensureCommandSectionValid(
        authLoginOtpRequestCommand,
        "body",
        otpRequestPayload,
        "Unable to request one-time code."
      );
      await request(AUTH_PATHS.LOGIN_OTP_REQUEST, {
        method: "POST",
        body: otpRequestPayload
      });
      setInfoMessage("One-time code sent. Check your inbox.", "auth-web.default-login-view:otp-code-sent");
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to request one-time code."));
    } finally {
      state.otpRequestPending.value = false;
    }
  }

  async function resendRegisterConfirmationEmail() {
    const normalizedEmail = normalizeEmailAddress(state.pendingEmailConfirmationAddress.value || state.email.value);
    if (!normalizedEmail) {
      setErrorMessage("Enter an email address before requesting confirmation.");
      return;
    }

    state.registerConfirmationResendPending.value = true;
    clearTransientMessages();
    try {
      const resendPayload = {
        email: normalizedEmail
      };
      ensureCommandSectionValid(
        authRegisterConfirmationResendCommand,
        "body",
        resendPayload,
        "Unable to resend confirmation email."
      );
      const resendResult = await request(AUTH_PATHS.REGISTER_CONFIRMATION_RESEND, {
        method: "POST",
        body: resendPayload
      });
      const info =
        String(resendResult?.message || "").trim() ||
        "If an account exists for that email, a confirmation email has been sent.";
      setInfoMessage(info, "auth-web.default-login-view:register-confirmation-resend");
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to resend confirmation email."));
    } finally {
      state.registerConfirmationResendPending.value = false;
    }
  }

  function oauthProviderButtonLabel(provider) {
    const providerLabel = String(provider?.label || provider?.id || "OAuth provider");
    if (state.isRegister.value) {
      return `Register with ${providerLabel}`;
    }
    if (state.showRememberedAccount.value) {
      return `Continue with ${providerLabel} as ${state.rememberedAccountDisplayName.value}`;
    }
    return `Continue with ${providerLabel}`;
  }

  function oauthProviderIcon(provider) {
    if (String(provider?.id || "").toLowerCase() === "google") {
      return mdiGoogle;
    }
    return undefined;
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
      returnTo: state.requestedReturnTo.value
    };
    try {
      ensureCommandSectionValid(
        authLoginOAuthStartCommand,
        "params",
        paramsPayload,
        "OAuth provider id is invalid."
      );
      ensureCommandSectionValid(
        authLoginOAuthStartCommand,
        "query",
        queryPayload,
        "OAuth return path is invalid."
      );
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to start OAuth sign-in."));
      return;
    }

    const params = new URLSearchParams(queryPayload);
    const oauthStartPath = buildAuthOauthStartPath(provider);
    window.location.assign(`${oauthStartPath}?${params.toString()}`);
  }

  async function initializeOnMounted() {
    state.applyRememberedAccountHint(readRememberedAccountHint());
    state.loading.value = true;
    try {
      const session = await refreshSession();
      const callbackHandled = await handleOAuthCallbackIfPresent();
      if (!callbackHandled && session?.authenticated && typeof window === "object" && window.location) {
        window.location.replace(state.requestedReturnTo.value);
      }
    } catch (error) {
      setErrorMessage(String(error?.message || "Unable to initialize sign in."));
    } finally {
      state.loading.value = false;
    }
  }

  return {
    submitAuth,
    requestOtpCode,
    resendRegisterConfirmationEmail,
    oauthProviderButtonLabel,
    oauthProviderIcon,
    startOAuthSignIn,
    initializeOnMounted
  };
}
