const AUTH_PATHS = Object.freeze({
  REGISTER: "/api/register",
  REGISTER_CONFIRMATION_RESEND: "/api/register/confirmation/resend",
  LOGIN: "/api/login",
  LOGIN_OTP_REQUEST: "/api/login/otp/request",
  LOGIN_OTP_VERIFY: "/api/login/otp/verify",
  OAUTH_START_TEMPLATE: "/api/oauth/:provider/start",
  OAUTH_COMPLETE: "/api/oauth/complete",
  PASSWORD_FORGOT: "/api/password/forgot",
  PASSWORD_RECOVERY: "/api/password/recovery",
  PASSWORD_RESET: "/api/password/reset",
  DEV_LOGIN_AS: "/api/dev-auth/login-as",
  LOGOUT: "/api/logout",
  SESSION: "/api/session"
});

function buildAuthOauthStartPath(provider) {
  const providerId = encodeURIComponent(
    String(provider || "")
      .trim()
      .toLowerCase()
  );
  return AUTH_PATHS.OAUTH_START_TEMPLATE.replace(":provider", providerId);
}

export { AUTH_PATHS, buildAuthOauthStartPath };
