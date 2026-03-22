const AUTH_ACTION_IDS = Object.freeze({
  REGISTER: "auth.register",
  REGISTER_CONFIRMATION_RESEND: "auth.register.confirmation.resend",
  LOGIN_PASSWORD: "auth.login.password",
  LOGIN_OTP_REQUEST: "auth.login.otp.request",
  LOGIN_OTP_VERIFY: "auth.login.otp.verify",
  LOGIN_OAUTH_START: "auth.login.oauth.start",
  LOGIN_OAUTH_COMPLETE: "auth.login.oauth.complete",
  LOGOUT: "auth.logout",
  SESSION_READ: "auth.session.read",
  PASSWORD_RESET_REQUEST: "auth.password.reset.request",
  PASSWORD_RECOVERY_COMPLETE: "auth.password.recovery.complete",
  PASSWORD_RESET: "auth.password.reset"
});

export { AUTH_ACTION_IDS };
