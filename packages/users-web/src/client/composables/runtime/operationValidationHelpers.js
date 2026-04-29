import {
  createValidationFailure,
  resolveFieldErrors
} from "@jskit-ai/http-runtime/client";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

function validateOperationInput({
  input,
  rawPayload = {},
  fieldBag = null,
  feedback = null,
  validationMessage = "Validation failed."
} = {}) {
  if (!input) {
    return {
      ok: true,
      parsedInput: rawPayload
    };
  }

  try {
    const parsedInput = validateSchemaPayload(input, rawPayload, {
      phase: "input",
      context: "operation input"
    });

    return {
      ok: true,
      parsedInput
    };
  } catch (error) {
    if (!error?.fieldErrors || typeof error.fieldErrors !== "object") {
      throw error;
    }

    const failure = createValidationFailure({
      error: String(validationMessage || "Validation failed."),
      code: "validation_failed",
      fieldErrors: error?.fieldErrors
    });
    fieldBag?.apply?.(resolveFieldErrors(failure));
    feedback?.error?.(failure, failure.error);
    return {
      ok: false,
      failure,
      parsedInput: null
    };
  }
}

export { validateOperationInput };
