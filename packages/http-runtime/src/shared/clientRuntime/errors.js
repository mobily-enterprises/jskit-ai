import { isRecord, resolveFieldErrors } from "../support/fieldErrors.js";
import { createJsonApiClientErrorPayload } from "./jsonApiResourceTransport.js";

function createHttpError(response, data = {}) {
  const payload = isRecord(data) ? data : {};
  const jsonApiPayload = createJsonApiClientErrorPayload(payload);
  if (jsonApiPayload) {
    return createHttpError(response, jsonApiPayload);
  }

  const error = new Error(payload.error || `Request failed with status ${response.status}.`);
  const normalizedFieldErrors = resolveFieldErrors(payload);
  error.status = Number(response?.status || 0);
  error.code = String(payload.code || "").trim() || null;
  error.fieldErrors = Object.keys(normalizedFieldErrors).length > 0 ? normalizedFieldErrors : null;
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
  error.code = null;
  error.fieldErrors = null;
  error.details = null;
  error.cause = cause;
  return error;
}

export {
  createHttpError,
  createNetworkError
};
