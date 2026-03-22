import { AUTH_PATHS, buildAuthOauthStartPath } from "./authPaths.js";

function createApi({ request }) {
  return {
    session() {
      return request(AUTH_PATHS.SESSION);
    },
    register(payload) {
      return request(AUTH_PATHS.REGISTER, { method: "POST", body: payload });
    },
    resendRegisterConfirmation(payload) {
      return request(AUTH_PATHS.REGISTER_CONFIRMATION_RESEND, { method: "POST", body: payload });
    },
    login(payload) {
      return request(AUTH_PATHS.LOGIN, { method: "POST", body: payload });
    },
    requestOtp(payload) {
      return request(AUTH_PATHS.LOGIN_OTP_REQUEST, { method: "POST", body: payload });
    },
    verifyOtp(payload) {
      return request(AUTH_PATHS.LOGIN_OTP_VERIFY, { method: "POST", body: payload });
    },
    oauthStartUrl(provider, options = {}) {
      const oauthStartPath = buildAuthOauthStartPath(provider);
      const returnTo = String(options.returnTo || "").trim();
      if (!returnTo) {
        return oauthStartPath;
      }

      const params = new URLSearchParams({
        returnTo
      });
      return `${oauthStartPath}?${params.toString()}`;
    },
    oauthComplete(payload) {
      return request(AUTH_PATHS.OAUTH_COMPLETE, { method: "POST", body: payload });
    },
    requestPasswordReset(payload) {
      return request(AUTH_PATHS.PASSWORD_FORGOT, { method: "POST", body: payload });
    },
    completePasswordRecovery(payload) {
      return request(AUTH_PATHS.PASSWORD_RECOVERY, { method: "POST", body: payload });
    },
    resetPassword(payload) {
      return request(AUTH_PATHS.PASSWORD_RESET, { method: "POST", body: payload });
    },
    logout() {
      return request(AUTH_PATHS.LOGOUT, { method: "POST" });
    }
  };
}

export { createApi };
