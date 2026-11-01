import { AUTH_PATHS, buildAuthOauthStartPath } from "./authPaths.js";

function createApi({ request }) {
  function session() {
    return request(AUTH_PATHS.SESSION);
  }

  function register(payload) {
    return request(AUTH_PATHS.REGISTER, { method: "POST", body: payload });
  }

  function resendRegisterConfirmation(payload) {
    return request(AUTH_PATHS.REGISTER_CONFIRMATION_RESEND, { method: "POST", body: payload });
  }

  function login(payload) {
    return request(AUTH_PATHS.LOGIN, { method: "POST", body: payload });
  }

  function requestOtp(payload) {
    return request(AUTH_PATHS.LOGIN_OTP_REQUEST, { method: "POST", body: payload });
  }

  function verifyOtp(payload) {
    return request(AUTH_PATHS.LOGIN_OTP_VERIFY, { method: "POST", body: payload });
  }

  function oauthStartUrl(provider, options = {}) {
    const oauthStartPath = buildAuthOauthStartPath(provider);
    const returnTo = String(options.returnTo || "").trim();
    if (!returnTo) {
      return oauthStartPath;
    }

    const params = new URLSearchParams({
      returnTo
    });
    return `${oauthStartPath}?${params.toString()}`;
  }

  function oauthComplete(payload) {
    return request(AUTH_PATHS.OAUTH_COMPLETE, { method: "POST", body: payload });
  }

  function devLoginAs(payload) {
    return request(AUTH_PATHS.DEV_LOGIN_AS, { method: "POST", body: payload });
  }

  function requestPasswordReset(payload) {
    return request(AUTH_PATHS.PASSWORD_FORGOT, { method: "POST", body: payload });
  }

  function completePasswordRecovery(payload) {
    return request(AUTH_PATHS.PASSWORD_RECOVERY, { method: "POST", body: payload });
  }

  function resetPassword(payload) {
    return request(AUTH_PATHS.PASSWORD_RESET, { method: "POST", body: payload });
  }

  function logout() {
    return request(AUTH_PATHS.LOGOUT, { method: "POST" });
  }

  return Object.freeze({
    session,
    register,
    resendRegisterConfirmation,
    login,
    requestOtp,
    verifyOtp,
    oauthStartUrl,
    oauthComplete,
    devLoginAs,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    logout
  });
}

export { createApi };
