import { resolveFieldErrors, normalizeFieldErrors } from "../shared/support/fieldErrors.js";

function createValidationFailure({
  error = "Validation failed.",
  code = "validation_failed",
  fieldErrors = {}
} = {}) {
  const normalizedFieldErrors = normalizeFieldErrors(fieldErrors);
  return {
    error: String(error || "Validation failed.").trim() || "Validation failed.",
    code: String(code || "validation_failed").trim() || "validation_failed",
    fieldErrors: normalizedFieldErrors,
    details: {
      fieldErrors: normalizedFieldErrors
    }
  };
}

export {
  normalizeFieldErrors,
  resolveFieldErrors,
  createValidationFailure
};
