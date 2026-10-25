import { createActionRuntimeError } from "./actionDefinitions.js";
import { normalizeText } from "../../shared/support/normalize.js";

function ensureIdempotencyKeyIfRequired(definition, context) {
  if (definition.idempotency !== "required") {
    return;
  }

  const key = normalizeText(context?.requestMeta?.idempotencyKey || context?.requestMeta?.commandId);
  if (key) {
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

export { ensureIdempotencyKeyIfRequired };
