import {
  createValidationFailure,
  resolveFieldErrors
} from "@jskit-ai/http-runtime/client";

function validateOperationInput({
  parseInput,
  rawPayload = {},
  context = {},
  fieldBag = null,
  feedback = null,
  validationMessage = "Validation failed."
} = {}) {
  if (typeof parseInput !== "function") {
    return {
      ok: true,
      parseResult: null,
      parsedInput: rawPayload
    };
  }

  const parseResult = parseInput(rawPayload, context);
  if (!parseResult || typeof parseResult !== "object" || typeof parseResult.ok !== "boolean") {
    throw new TypeError(
      "parseInput(rawPayload, context) must return validateOperationSection-compatible result with boolean ok."
    );
  }

  if (!parseResult.ok) {
    const failure = createValidationFailure({
      error: String(validationMessage || "Validation failed."),
      code: "validation_failed",
      fieldErrors: parseResult.fieldErrors
    });
    fieldBag?.apply?.(resolveFieldErrors(failure));
    feedback?.error?.(failure, failure.error);
    return {
      ok: false,
      failure,
      parseResult,
      parsedInput: null
    };
  }

  return {
    ok: true,
    parseResult,
    parsedInput: parseResult.value
  };
}

export { validateOperationInput };
