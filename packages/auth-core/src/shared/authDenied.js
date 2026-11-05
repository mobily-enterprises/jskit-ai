const AUTH_DENIED_CODE_MAX_LENGTH = 80;
const AUTH_DENIED_MESSAGE_MAX_LENGTH = 240;
const AUTH_DENIED_CODE_PATTERN = "^[a-z][a-z0-9_.:-]{1,79}$";

const AUTH_DENIED_CODES = Object.freeze({
  NOT_ALLOWLISTED: "not_allowlisted",
  BLOCKED: "blocked"
});

// The denial a built-in reason gets when the app sends no message, and the one
// any other reason gets: the English and the code a client renders it from.
const AUTH_DENIED_DEFAULT_TEXTS = Object.freeze({
  [AUTH_DENIED_CODES.NOT_ALLOWLISTED]: Object.freeze({
    message: "This account is not allowed to access this application.",
    messageCode: "auth.denied.notAllowlistedDefault"
  }),
  [AUTH_DENIED_CODES.BLOCKED]: Object.freeze({
    message: "This account has been blocked from accessing this application.",
    messageCode: "auth.denied.blockedDefault"
  })
});
const AUTH_DENIED_FALLBACK_TEXT = Object.freeze({
  message: "This account cannot access this application.",
  messageCode: "auth.denied.unspecified"
});

const AUTH_DENIED_DEFAULT_MESSAGES = Object.freeze(Object.fromEntries(
  Object.entries(AUTH_DENIED_DEFAULT_TEXTS).map(([code, text]) => [code, text.message])
));

// The sign-in error for each built-in reason: its English and the code a client
// renders it from in the user's language.
const AUTH_DENIED_LOGIN_TEXTS = Object.freeze({
  [AUTH_DENIED_CODES.NOT_ALLOWLISTED]: Object.freeze({
    message: "Sign-in succeeded, but this account is not allowed to access this application.",
    messageCode: "auth.denied.notAllowlisted"
  }),
  [AUTH_DENIED_CODES.BLOCKED]: Object.freeze({
    message: "Sign-in succeeded, but this account has been blocked from accessing this application.",
    messageCode: "auth.denied.blocked"
  })
});

const AUTH_DENIED_LOGIN_MESSAGES = Object.freeze(Object.fromEntries(
  Object.entries(AUTH_DENIED_LOGIN_TEXTS).map(([code, text]) => [code, text.message])
));

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
  const message = explicitMessage || AUTH_DENIED_DEFAULT_MESSAGES[code] || AUTH_DENIED_FALLBACK_TEXT.message;

  return Object.freeze({
    code,
    message: message.slice(0, AUTH_DENIED_MESSAGE_MAX_LENGTH)
  });
}

// { message, messageCode? } for a denied session, or null. A reason the app
// defined itself keeps the message it sent, without a code, or the coded fallback
// when it sent none.
function resolveAuthDeniedLoginText(input = null) {
  const authDenied = normalizeAuthDenied(input);
  if (!authDenied) {
    return null;
  }

  return AUTH_DENIED_LOGIN_TEXTS[authDenied.code] ||
    (authDenied.message === AUTH_DENIED_FALLBACK_TEXT.message
      ? AUTH_DENIED_FALLBACK_TEXT
      : Object.freeze({ message: authDenied.message }));
}

function resolveAuthDeniedLoginMessage(input = null) {
  return resolveAuthDeniedLoginText(input)?.message || "";
}

export {
  AUTH_DENIED_CODE_MAX_LENGTH,
  AUTH_DENIED_CODE_PATTERN,
  AUTH_DENIED_CODES,
  AUTH_DENIED_DEFAULT_MESSAGES,
  AUTH_DENIED_DEFAULT_TEXTS,
  AUTH_DENIED_FALLBACK_TEXT,
  AUTH_DENIED_LOGIN_MESSAGES,
  AUTH_DENIED_LOGIN_TEXTS,
  AUTH_DENIED_MESSAGE_MAX_LENGTH,
  normalizeAuthDenied,
  normalizeAuthDeniedCode,
  resolveAuthDeniedLoginMessage,
  resolveAuthDeniedLoginText
};
