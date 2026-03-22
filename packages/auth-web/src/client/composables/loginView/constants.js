const LOGIN_MODE = "login";
const REGISTER_MODE = "register";
const FORGOT_MODE = "forgot";
const OTP_MODE = "otp";
const EMAIL_CONFIRMATION_MODE = "confirm-email";

const AUTH_TITLE_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "Welcome back",
  [REGISTER_MODE]: "Create your account",
  [FORGOT_MODE]: "Reset your password",
  [OTP_MODE]: "Use one-time code",
  [EMAIL_CONFIRMATION_MODE]: "Confirm your email"
});

const AUTH_SUBTITLE_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "Sign in to continue.",
  [REGISTER_MODE]: "Register to access your workspace.",
  [FORGOT_MODE]: "We will send password reset instructions to your email.",
  [OTP_MODE]: "Request a one-time login code and verify it below."
});

const SUBMIT_LABEL_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "Sign in",
  [REGISTER_MODE]: "Register",
  [FORGOT_MODE]: "Send reset instructions",
  [OTP_MODE]: "Verify code",
  [EMAIL_CONFIRMATION_MODE]: "Continue"
});

const DEFAULT_REGISTER_CONFIRMATION_MESSAGE = "Check your email to confirm the account before logging in.";

export {
  LOGIN_MODE,
  REGISTER_MODE,
  FORGOT_MODE,
  OTP_MODE,
  EMAIL_CONFIRMATION_MODE,
  AUTH_TITLE_BY_MODE,
  AUTH_SUBTITLE_BY_MODE,
  SUBMIT_LABEL_BY_MODE,
  DEFAULT_REGISTER_CONFIRMATION_MESSAGE
};
