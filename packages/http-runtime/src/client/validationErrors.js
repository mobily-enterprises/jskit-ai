import { isRecord, resolveFieldErrors, normalizeFieldErrors } from "../shared/support/fieldErrors.js";

// A client-side validation failure shaped like the server's validation response:
// code validation_failed (whose English is "Validation failed.") and, for fields
// whose sentence has one, details.fieldErrorCodes.
function createValidationFailure({
  error = "Validation failed.",
  code = "validation_failed",
  fieldErrors = {},
  fieldErrorCodes = null
} = {}) {
  const normalizedFieldErrors = normalizeFieldErrors(fieldErrors);
  const hasFieldErrorCodes = isRecord(fieldErrorCodes) && Object.keys(fieldErrorCodes).length > 0;
  return {
    error: String(error || "Validation failed.").trim() || "Validation failed.",
    code: String(code || "validation_failed").trim() || "validation_failed",
    fieldErrors: normalizedFieldErrors,
    details: {
      fieldErrors: normalizedFieldErrors,
      ...(hasFieldErrorCodes ? { fieldErrorCodes } : {})
    }
  };
}

export {
  normalizeFieldErrors,
  resolveFieldErrors,
  createValidationFailure
};
