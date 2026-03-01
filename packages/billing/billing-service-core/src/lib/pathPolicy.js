import { normalizeReturnToPath } from "@jskit-ai/access-core/utils";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

function normalizeBillingPath(value, { fieldName }) {
  const fallback = "__invalid__";
  const normalized = normalizeReturnToPath(value, { fallback });
  if (normalized === fallback) {
    throw new AppError(400, "Validation failed.", {
      code: "VALIDATION_ERROR",
      details: {
        fieldErrors: {
          [fieldName]: `${fieldName} must be a relative path starting with '/'.`
        }
      }
    });
  }

  return normalized;
}

function normalizeCheckoutPaths(payload = {}) {
  return {
    successPath: normalizeBillingPath(payload.successPath, { fieldName: "successPath" }),
    cancelPath: normalizeBillingPath(payload.cancelPath, { fieldName: "cancelPath" })
  };
}

function normalizePortalPath(payload = {}) {
  return {
    returnPath: normalizeBillingPath(payload.returnPath, { fieldName: "returnPath" })
  };
}

const __testables = {
  normalizeBillingPath
};

export { normalizeBillingPath, normalizeCheckoutPaths, normalizePortalPath, __testables };
