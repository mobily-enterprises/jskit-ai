import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { catalogMessage, formatMessage, messageKeyForCode } from "@jskit-ai/kernel/shared/i18n";
import english from "../../locales/en.json" with { type: "json" };

// Texts every auth provider means the same way. Each code's English lives once,
// in auth-core's catalog, so providers use these entries instead of their own
// copy of the sentence.
const AUTH_TEXTS = Object.freeze({
  sessionRequired: Object.freeze({ status: 401, code: "auth.session.required" }),
  sessionUnavailable: Object.freeze({ status: 503, code: "auth.session.unavailable" }),
  invalidCredentials: Object.freeze({ status: 401, code: "auth.login.invalidCredentials" }),
  emailRequired: Object.freeze({ status: 400, code: "auth.validation.emailRequired" }),
  devUserRequired: Object.freeze({ status: 400, code: "auth.dev.userRequired" }),
  devUserNotFound: Object.freeze({ status: 400, code: "auth.dev.userNotFound" }),
  displayNameRequired: Object.freeze({ status: 400, code: "auth.profile.displayNameRequired" }),
  recoveryTokenRequired: Object.freeze({ status: 400, code: "auth.recovery.tokenRequired" }),
  passwordUpdatedSignIn: Object.freeze({ code: "auth.password.updatedSignIn" })
});

function authText({ code } = {}, params = {}) {
  const template = catalogMessage(english, messageKeyForCode(code));
  if (template === undefined) {
    throw new TypeError(`Auth text "${code}" is not in auth-core's catalog.`);
  }
  return formatMessage(template, params);
}

function createAuthError(entry, { params = {}, ...options } = {}) {
  return new AppError(entry.status, authText(entry, params), { ...options, code: entry.code, params });
}

// One field's error for createValidationError.
function authFieldError(entry, params = {}) {
  return { code: entry.code, params, message: authText(entry, params) };
}

// details for an error that names its fields itself: { field: entry }.
function authFieldErrorDetails(fields = {}) {
  const fieldErrors = {};
  const fieldErrorCodes = {};
  for (const [field, entry] of Object.entries(fields)) {
    fieldErrors[field] = authText(entry);
    fieldErrorCodes[field] = { code: entry.code, params: {} };
  }
  return { fieldErrors, fieldErrorCodes };
}

// A success payload's text: the English message plus the code a client renders.
function authMessageFields(entry, params = {}) {
  return { message: authText(entry, params), messageCode: entry.code, messageParams: params };
}

export {
  AUTH_TEXTS,
  authFieldError,
  authFieldErrorDetails,
  authMessageFields,
  authText,
  createAuthError
};
