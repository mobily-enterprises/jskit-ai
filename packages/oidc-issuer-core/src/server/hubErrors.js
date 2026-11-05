import { HubError } from "./http.js";
import { hubEnglish } from "./hubTexts.js";

// Each refusal a person can see: its status, its code and the messageCode its
// English renders from. The hub's pages show it in the person's language.
const HUB_ERRORS = Object.freeze({
  signInRequired: { status: 401, code: "sign_in_required", messageCode: "accounts.signIn.required" },
  ownerRequired: { status: 403, code: "owner_required", messageCode: "accounts.admin.ownerRequired" },
  tooManyAttempts: { status: 429, code: "rate_limited", messageCode: "accounts.request.tooManyAttempts" },
  interactionExpired: { status: 404, code: "interaction_expired", messageCode: "accounts.signIn.expired" },
  appPending: { status: 409, code: "app_pending", messageCode: "accounts.app.pending" },
  emailUnconfirmed: { status: 409, code: "email_unconfirmed", messageCode: "accounts.signIn.emailUnconfirmed" },
  signInFailed: { status: 401, code: "sign_in_failed", messageCode: "accounts.signIn.noMatch" },
  confirmLinkExpired: { status: 410, code: "confirm_link_expired", messageCode: "accounts.account.confirmLinkExpired" },
  emailInvalid: { status: 400, code: "email_invalid", messageCode: "accounts.account.emailInvalid" },
  recoveryLinkExpired: { status: 410, code: "recovery_link_expired", messageCode: "accounts.password.recoveryLinkExpired" },
  currentPasswordWrong: { status: 400, code: "current_password_wrong", messageCode: "accounts.password.currentWrong" },
  googleDisabled: { status: 404, code: "google_disabled", messageCode: "accounts.google.disabled" },
  googleConnectionExpired: {
    status: 410,
    code: "google_connection_expired",
    messageCode: "accounts.google.connectionExpired"
  },
  googleLinkExpired: { status: 410, code: "google_link_expired", messageCode: "accounts.google.linkExpired" },
  googleTaken: { status: 409, code: "google_taken", messageCode: "accounts.google.taken" },
  unknownAction: { status: 404, code: "unknown_action", messageCode: "accounts.admin.unknownAction" },
  appNotFound: { status: 404, code: "app_not_found", messageCode: "accounts.admin.appNotFound" },
  ownerSelf: { status: 400, code: "owner_self", messageCode: "accounts.admin.ownerSelf" },
  personNotFound: { status: 404, code: "person_not_found", messageCode: "accounts.admin.personNotFound" },
  testEmailFailed: { status: 502, code: "email_failed", messageCode: "accounts.admin.testEmailFailed" },
  hubRequestRequired: { status: 403, code: "hub_request_required", messageCode: "accounts.request.hubPagesOnly" },
  failed: { status: 500, code: "hub_failed", messageCode: "accounts.request.failed" }
});

/** A refusal in English, with the messageCode and params that render it. */
function hubError(entry, messageParams = {}) {
  return new HubError(entry.status, entry.code, hubEnglish(entry.messageCode, messageParams), {
    messageCode: entry.messageCode,
    messageParams
  });
}

/** The API's answer to a refusal: its code and English, and its messageCode when it has one. */
function errorBody(error) {
  return {
    error: error.code,
    message: error.message,
    ...(error.messageCode ? { messageCode: error.messageCode, messageParams: error.messageParams } : {})
  };
}

export { HUB_ERRORS, errorBody, hubError };
