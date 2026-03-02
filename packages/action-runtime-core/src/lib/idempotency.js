import { createActionRuntimeError } from "./contracts.js";
import { normalizeText } from "./textNormalization.js";

function resolveRequestIdempotencyKey(context) {
  return normalizeText(context?.requestMeta?.idempotencyKey || context?.requestMeta?.commandId || "");
}

function resolveActionIdempotencyKey(definition, context) {
  const policy = normalizeText(definition?.idempotency || "none").toLowerCase();
  if (policy === "none") {
    return "";
  }

  return resolveRequestIdempotencyKey(context);
}

function createNoopIdempotencyAdapter() {
  return {
    async claimOrReplay() {
      return {
        type: "proceed",
        idempotencyReplay: false,
        claim: null,
        replayResult: null
      };
    },
    async markSucceeded() {},
    async markFailed() {}
  };
}

function ensureIdempotencyKeyIfRequired(definition, context, key) {
  const policy = normalizeText(definition?.idempotency || "none").toLowerCase();
  if (policy !== "required") {
    return;
  }

  if (normalizeText(key)) {
    return;
  }

  throw createActionRuntimeError(400, "Validation failed.", {
    code: "ACTION_IDEMPOTENCY_KEY_REQUIRED",
    details: {
      fieldErrors: {
        idempotencyKey: "Idempotency key is required for this action."
      }
    }
  });
}

const __testables = {
  normalizeText,
  resolveRequestIdempotencyKey
};

export {
  resolveActionIdempotencyKey,
  ensureIdempotencyKeyIfRequired,
  createNoopIdempotencyAdapter,
  __testables
};
