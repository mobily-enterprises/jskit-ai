import { mdiGoogle } from "@mdi/js";
import { authRegisterCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterCommand";
import { authRegisterConfirmationResendCommand } from "@jskit-ai/auth-core/shared/commands/authRegisterConfirmationResendCommand";
import { authLoginPasswordCommand } from "@jskit-ai/auth-core/shared/commands/authLoginPasswordCommand";
import { authLoginOtpRequestCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpRequestCommand";
import { authLoginOtpVerifyCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOtpVerifyCommand";
import { authLoginOAuthStartCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authPasswordResetRequestCommand } from "@jskit-ai/auth-core/shared/commands/authPasswordResetRequestCommand";
import { AUTH_PATHS, buildAuthOauthStartPath } from "@jskit-ai/auth-core/shared/authPaths";
import { authHttpRequest } from "../../runtime/authHttpClient.js";
import { completeOAuthCallbackFromCurrentLocation } from "../../runtime/oauthCallbackRuntime.js";
import { normalizeAuthReturnToPath } from "../../lib/returnToPath.js";
import { normalizeEmailAddress } from "./identityHelpers.js";
import { readRememberedAccountHint } from "./rememberedAccountStorage.js";
import { stripOAuthParamsFromLocation } from "./oauthCallbackUrl.js";
import { completeOAuthPopupSignIn } from "../../runtime/popupOAuthLaunchClient.js";
import { ensureCommandSectionValid } from "./validationHelpers.js";
import { resolveRegisterCompletionState } from "./registerCompletion.js";
import { inactiveSessionMessage } from "../../runtime/inactiveSessionMessage.js";
import { useJskitText } from "../../i18n.js";

const SESSION_QUERY_KEY = Object.freeze(["auth-web", "session"]);

export function useLoginViewActions({
  state,
  validation,
  queryClient,
  errorRuntime,
  oauthLaunchClient = null
} = {}) {
  const { serverMessage, t } = useJskitText();

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
    if (typeof state.applyCapabilities === "function") {
      state.applyCapabilities(payload || {});
    }
    if (payload?.authCapabilities || payload?.capabilities) {
      return;
    }

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
      throw new Error(inactiveSessionMessage(session));
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
    const invitationToken = String(state.invitationToken?.value || "").trim();
    if (invitationToken) {
      registerPayload.invitation = {
        token: invitationToken,
        source: "workspace-invite"
      };
    }
    ensureCommandSectionValid(authRegisterCommand, "body", registerPayload, t("jskit.auth.login.error.registerFailed"));

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
      t("jskit.auth.login.error.resetRequestFailed")
    );

    await request(AUTH_PATHS.PASSWORD_FORGOT, {
      method: "POST",
      body: forgotPayload
    });
    setInfoMessage(t("jskit.auth.login.resetSent"), "auth-web.default-login-view:password-reset-sent");
  }

  async function submitOtp({ normalizedEmail, shouldRememberAccount }) {
    const otpPayload = {
      email: normalizedEmail,
      token: String(state.otpCode.value || "").trim(),
      type: "email"
    };
    ensureCommandSectionValid(
      authLoginOtpVerifyCommand,
      "body",
      otpPayload,
      t("jskit.auth.login.error.otpVerifyFailed")
    );

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
    ensureCommandSectionValid(authLoginPasswordCommand, "body", loginPayload, t("jskit.auth.login.error.signInFailed"));

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

  async function handleOAuthCallbackIfPresent() {
    const callbackResult = await completeOAuthCallbackFromCurrentLocation({
      fallbackReturnTo: state.requestedReturnTo.value,
      allowedReturnToOrigins: state.allowedReturnToOrigins.value,
      defaultProvider: resolveDefaultOAuthProvider(),
      request,
      refreshSession
    });

    if (callbackResult.handled !== true) {
      return false;
    }

    state.requestedReturnTo.value = normalizeAuthReturnToPath(
      callbackResult.returnTo,
      state.requestedReturnTo.value,
      {
        allowedOrigins: state.allowedReturnToOrigins.value
      }
    );

    state.loading.value = true;
    clearTransientMessages();

    try {
      if (callbackResult.completed !== true) {
        throw new Error(callbackResult.errorMessage || t("jskit.auth.login.error.oauthCompleteFailed"));
      }

      state.applyRememberedAccountPreference({
        email: callbackResult.oauthResult?.email || state.email.value,
        displayName:
          callbackResult.oauthResult?.username || callbackResult.oauthResult?.email || state.email.value,
        shouldRemember: state.rememberAccountOnDevice.value !== false
      });

      // A sign-in window opened by a framed app hands back and closes; if the
      // browser keeps it open, it continues like an ordinary sign-in.
      completeOAuthPopupSignIn();
      stripOAuthParamsFromLocation();
      if (typeof window === "object" && window.location) {
        window.location.replace(state.requestedReturnTo.value);
      }
    } catch (error) {
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.oauthCompleteFailed")));
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
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.authFailed")));
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
        t("jskit.auth.login.error.otpRequestFailed")
      );
      await request(AUTH_PATHS.LOGIN_OTP_REQUEST, {
        method: "POST",
        body: otpRequestPayload
      });
      setInfoMessage(t("jskit.auth.login.otpSent"), "auth-web.default-login-view:otp-code-sent");
    } catch (error) {
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.otpRequestFailed")));
    } finally {
      state.otpRequestPending.value = false;
    }
  }

  async function resendRegisterConfirmationEmail() {
    const normalizedEmail = normalizeEmailAddress(state.pendingEmailConfirmationAddress.value || state.email.value);
    if (!normalizedEmail) {
      setErrorMessage(t("jskit.auth.login.error.emailRequiredForConfirmation"));
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
        t("jskit.auth.login.error.resendConfirmationFailed")
      );
      const resendResult = await request(AUTH_PATHS.REGISTER_CONFIRMATION_RESEND, {
        method: "POST",
        body: resendPayload
      });
      const info = serverMessage(resendResult).trim() || t("jskit.auth.login.confirmEmail.resent");
      setInfoMessage(info, "auth-web.default-login-view:register-confirmation-resend");
    } catch (error) {
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.resendConfirmationFailed")));
    } finally {
      state.registerConfirmationResendPending.value = false;
    }
  }

  function oauthProviderButtonLabel(provider) {
    const providerLabel = String(provider?.label || provider?.id || t("jskit.auth.login.oauth.providerFallback"));
    if (state.isRegister.value) {
      return t("jskit.auth.login.oauth.register", { provider: providerLabel });
    }
    if (state.showRememberedAccount.value) {
      return t("jskit.auth.login.oauth.continueAs", {
        provider: providerLabel,
        name: state.rememberedAccountDisplayName.value
      });
    }
    return t("jskit.auth.login.oauth.continue", { provider: providerLabel });
  }

  function oauthProviderIcon(provider) {
    if (String(provider?.id || "").toLowerCase() === "google") {
      return mdiGoogle;
    }
    return undefined;
  }

  async function startOAuthSignIn(providerId) {
    const provider = String(providerId || "").trim().toLowerCase();
    if (!provider) {
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
        t("jskit.auth.login.error.oauthProviderInvalid")
      );
      ensureCommandSectionValid(
        authLoginOAuthStartCommand,
        "query",
        queryPayload,
        t("jskit.auth.login.error.oauthReturnToInvalid")
      );
    } catch (error) {
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.oauthStartFailed")));
      return;
    }

    const params = new URLSearchParams(queryPayload);
    const oauthStartPath = buildAuthOauthStartPath(provider);
    try {
      if (!oauthLaunchClient || typeof oauthLaunchClient.open !== "function") {
        throw new Error(t("jskit.auth.login.error.oauthLaunchUnavailable"));
      }
      await oauthLaunchClient.open({
        url: `${oauthStartPath}?${params.toString()}`
      });
    } catch (error) {
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.oauthStartFailed")));
    }
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
      setErrorMessage(serverMessage(error, t("jskit.auth.login.error.initializeFailed")));
    } finally {
      state.loading.value = false;
    }
  }

  // A session can start while this page stays open: signed in from another tab,
  // an identity switch, or the page restored from the back-forward cache.
  async function redirectIfSignedIn() {
    if (state.loading.value) {
      return;
    }
    try {
      const session = await refreshSession();
      if (session?.authenticated && typeof window === "object" && window.location) {
        window.location.replace(state.requestedReturnTo.value);
      }
    } catch {
      // Still signed out, or offline: the form stays as it is.
    }
  }

  return {
    submitAuth,
    requestOtpCode,
    resendRegisterConfirmationEmail,
    oauthProviderButtonLabel,
    oauthProviderIcon,
    startOAuthSignIn,
    initializeOnMounted,
    redirectIfSignedIn
  };
}
