const LOGIN_MODE = "login";
const REGISTER_MODE = "register";
const FORGOT_MODE = "forgot";
const OTP_MODE = "otp";
const EMAIL_CONFIRMATION_MODE = "confirm-email";

// Message keys per mode; an empty entry shows nothing.
const AUTH_TITLE_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "",
  [REGISTER_MODE]: "jskit.auth.login.title.register",
  [FORGOT_MODE]: "jskit.auth.login.title.forgot",
  [OTP_MODE]: "jskit.auth.login.title.otp",
  [EMAIL_CONFIRMATION_MODE]: "jskit.auth.login.title.confirmEmail"
});

const AUTH_SUBTITLE_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "",
  [REGISTER_MODE]: "jskit.auth.login.subtitle.register",
  [FORGOT_MODE]: "jskit.auth.login.subtitle.forgot",
  [OTP_MODE]: "jskit.auth.login.subtitle.otp"
});

const SUBMIT_LABEL_BY_MODE = Object.freeze({
  [LOGIN_MODE]: "jskit.auth.login.submit.login",
  [REGISTER_MODE]: "jskit.auth.login.submit.register",
  [FORGOT_MODE]: "jskit.auth.login.submit.forgot",
  [OTP_MODE]: "jskit.auth.login.submit.otp",
  [EMAIL_CONFIRMATION_MODE]: "jskit.auth.login.submit.confirmEmail"
});

export {
  LOGIN_MODE,
  REGISTER_MODE,
  FORGOT_MODE,
  OTP_MODE,
  EMAIL_CONFIRMATION_MODE,
  AUTH_TITLE_BY_MODE,
  AUTH_SUBTITLE_BY_MODE,
  SUBMIT_LABEL_BY_MODE
};
