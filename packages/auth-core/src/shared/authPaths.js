const AUTH_PATHS = Object.freeze({
  REGISTER: "/api/register",
  REGISTER_CONFIRMATION_RESEND: "/api/register/confirmation/resend",
  REGISTER_CONFIRM: "/api/register/confirm",
  LOGIN: "/api/login",
  LOGIN_OTP_REQUEST: "/api/login/otp/request",
  LOGIN_OTP_VERIFY: "/api/login/otp/verify",
  LOGIN_PASS: "/api/login/pass",
  OAUTH_START_TEMPLATE: "/api/oauth/:provider/start",
  OAUTH_COMPLETE: "/api/oauth/complete",
  PASSWORD_FORGOT: "/api/password/forgot",
  PASSWORD_RECOVERY: "/api/password/recovery",
  PASSWORD_RESET: "/api/password/reset",
  DEV_LOGIN_AS: "/api/dev-auth/login-as",
  LOGOUT: "/api/logout",
  SESSION: "/api/session",
  SECOND_FACTOR: "/api/second-factor",
  SECOND_FACTOR_SETUP: "/api/second-factor/setup",
  SECOND_FACTOR_SETUP_CONFIRM: "/api/second-factor/setup/confirm",
  SECOND_FACTOR_VERIFY: "/api/second-factor/verify",
  SECOND_FACTOR_RECOVERY_CODES: "/api/second-factor/recovery-codes",
  EMAIL_CHANGE: "/api/email-change",
  EMAIL_CHANGE_CONFIRM: "/api/email-change/confirm"
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
