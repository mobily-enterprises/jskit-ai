function normalizeFieldErrors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

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
    fieldBag?.apply?.(normalizeFieldErrors(parseResult.fieldErrors));
    feedback?.error?.(null, String(validationMessage || "Validation failed."));
    return {
      ok: false,
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
