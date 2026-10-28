import { normalizeTransactionOutcome } from "@jskit-ai/kernel/shared/support/normalize";
import { isRecord, resolveFieldErrors } from "../support/fieldErrors.js";
import { createJsonApiClientErrorPayload } from "./jsonApiResourceTransport.js";

function standardErrorMessage(payload = {}) {
  const nestedMessage = Array.isArray(payload.errors)
    ? payload.errors.find((entry) => isRecord(entry) && String(entry.message || "").trim())?.message
    : "";
  return String(payload.error || payload.message || nestedMessage || "").trim();
}

function genericHttpErrorMessage(status) {
  return `Request failed with status ${status}.`;
}

function resolveErrorStatus(error) {
  if (error == null || typeof error !== "object") {
    return null;
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(error, "status");
  const hasStatusCode = Object.prototype.hasOwnProperty.call(error, "statusCode");
  if (!hasStatus && !hasStatusCode) {
    return null;
  }

  const status = Number(hasStatus ? error.status : error.statusCode);
  return Number.isInteger(status) ? status : null;
}

// True when the error carries only the transport's own wording (a network
// failure or the status-only message createHttpError falls back to), so a
// caller's specific fallback copy is more useful than the message.
function isGenericHttpErrorMessage(error) {
  const normalizedMessage = String(error?.message || "").trim();
  if (!normalizedMessage) {
    return false;
  }

  const status = resolveErrorStatus(error);
  if (status === 0) {
    return true;
  }

  return status != null && status >= 400 && normalizedMessage === genericHttpErrorMessage(status);
}

function createHttpError(response, data = {}) {
  const payload = isRecord(data) ? data : {};
  const message = standardErrorMessage(payload);
  const jsonApiPayload = message ? null : createJsonApiClientErrorPayload(payload);
  if (jsonApiPayload) {
    return createHttpError(response, jsonApiPayload);
  }

  const error = new Error(message || genericHttpErrorMessage(response.status));
  const normalizedFieldErrors = resolveFieldErrors(payload);
  error.status = Number(response?.status || 0);
  error.code = String(payload.code || "").trim() || null;
  error.params = isRecord(payload.params) ? payload.params : {};
  if (payload.messageCode) {
    error.messageCode = String(payload.messageCode);
    error.messageParams = isRecord(payload.messageParams) ? payload.messageParams : {};
  } else if (!message) {
    error.messageCode = "http.request.failedWithStatus";
    error.messageParams = { status: error.status };
  }
  const transactionOutcome = normalizeTransactionOutcome(payload.transactionOutcome);
  if (transactionOutcome) {
    error.transactionOutcome = transactionOutcome;
  }
  error.fieldErrors = Object.keys(normalizedFieldErrors).length > 0 ? normalizedFieldErrors : null;
  error.fieldErrorCodes = isRecord(payload.details?.fieldErrorCodes) ? payload.details.fieldErrorCodes : null;
  if (isRecord(payload.details)) {
    error.details = payload.details;
  } else if (error.fieldErrors) {
    error.details = {
      fieldErrors: error.fieldErrors
    };
  } else {
    error.details = null;
  }
  return error;
}

function createNetworkError(cause) {
  const error = new Error("Network request failed.");
  error.status = 0;
  // Request recovery reads the cause's own code, so the text has a messageCode.
  error.code = null;
  error.messageCode = "http.request.networkFailed";
  error.messageParams = {};
  error.fieldErrors = null;
  error.details = null;
  error.cause = cause;
  return error;
}

export {
  createHttpError,
  createNetworkError,
  isGenericHttpErrorMessage
};
