const AUTH_DENIED_CODE_MAX_LENGTH = 80;
const AUTH_DENIED_MESSAGE_MAX_LENGTH = 240;
const AUTH_DENIED_CODE_PATTERN = "^[a-z][a-z0-9_.:-]{1,79}$";

const AUTH_DENIED_CODES = Object.freeze({
  NOT_ALLOWLISTED: "not_allowlisted",
  BLOCKED: "blocked"
});

const AUTH_DENIED_DEFAULT_MESSAGES = Object.freeze({
  [AUTH_DENIED_CODES.NOT_ALLOWLISTED]: "This account is not allowed to access this application.",
  [AUTH_DENIED_CODES.BLOCKED]: "This account has been blocked from accessing this application."
});

const AUTH_DENIED_LOGIN_MESSAGES = Object.freeze({
  [AUTH_DENIED_CODES.NOT_ALLOWLISTED]:
    "Sign-in succeeded, but this account is not allowed to access this application.",
  [AUTH_DENIED_CODES.BLOCKED]:
    "Sign-in succeeded, but this account has been blocked from accessing this application."
});

function normalizeAuthDeniedCode(value = "") {
  const code = String(value || "")
    .trim()
    .toLowerCase();
  if (!code || code.length > AUTH_DENIED_CODE_MAX_LENGTH) {
    return "";
  }
  return new RegExp(AUTH_DENIED_CODE_PATTERN).test(code) ? code : "";
}

function normalizeAuthDenied(input = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const code = normalizeAuthDeniedCode(input.code);
  if (!code) {
    return null;
  }

  const explicitMessage = String(input.message || "").trim();
  const message = explicitMessage || AUTH_DENIED_DEFAULT_MESSAGES[code] || "This account cannot access this application.";

  return Object.freeze({
    code,
    message: message.slice(0, AUTH_DENIED_MESSAGE_MAX_LENGTH)
  });
}

function resolveAuthDeniedLoginMessage(input = null) {
  const authDenied = normalizeAuthDenied(input);
  if (!authDenied) {
    return "";
  }

  return AUTH_DENIED_LOGIN_MESSAGES[authDenied.code] || authDenied.message;
}

export {
  AUTH_DENIED_CODE_MAX_LENGTH,
  AUTH_DENIED_CODE_PATTERN,
  AUTH_DENIED_CODES,
  AUTH_DENIED_DEFAULT_MESSAGES,
  AUTH_DENIED_LOGIN_MESSAGES,
  AUTH_DENIED_MESSAGE_MAX_LENGTH,
  normalizeAuthDenied,
  normalizeAuthDeniedCode,
  resolveAuthDeniedLoginMessage
};
