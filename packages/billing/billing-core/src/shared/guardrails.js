import { AppError } from "@jskit-ai/server-runtime-core/errors";

function createGuardrailRecorder(observabilityService) {
  return function recordGuardrail(code, context = {}) {
    const payload = {
      code,
      ...(context && typeof context === "object" ? context : {})
    };

    if (observabilityService && typeof observabilityService.recordGuardrail === "function") {
      observabilityService.recordGuardrail(payload);
      return;
    }

    if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
      return;
    }

    observabilityService.recordDbError({
      code
    });
  };
}

async function withLeaseFence({
  update,
  patch = {},
  shouldFence = true,
  guardrailRecorder = null,
  guardrailCode = null,
  guardrailContext = null,
  errorMessage = "Lease fencing mismatch.",
  errorCode = null,
  errorDetails = null
} = {}) {
  if (typeof update !== "function") {
    throw new TypeError("withLeaseFence requires update function.");
  }

  const updated = await update(patch);
  if (!updated && shouldFence) {
    if (typeof guardrailRecorder === "function" && guardrailCode) {
      guardrailRecorder(guardrailCode, guardrailContext || { measure: "count", value: 1 });
    }

    const errorPayload = {
      code: errorCode || guardrailCode
    };
    if (errorDetails && typeof errorDetails === "object") {
      errorPayload.details = errorDetails;
    }

    throw new AppError(409, errorMessage, errorPayload);
  }

  return updated;
}

export { createGuardrailRecorder, withLeaseFence };
