import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

function resolveOperationSection(operation = {}, section = "body") {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    return null;
  }

  return operation[section] == null ? null : operation[section];
}

function isFieldValidationError(error) {
  return Boolean(error?.fieldErrors && typeof error.fieldErrors === "object");
}

// fieldErrors are the English sentences; fieldErrorCodes ({ field: { code, params } })
// render the coded ones in the user's language.
function validateOperationSection({
  operation = {},
  section = "body",
  value
} = {}) {
  const sectionDefinition = resolveOperationSection(operation, section);
  if (!sectionDefinition) {
    return { ok: true, value, fieldErrors: {}, fieldErrorCodes: {} };
  }

  try {
    const normalized = validateSchemaPayload(sectionDefinition, value, {
      phase: "input",
      context: `operation section "${section}"`
    });

    return { ok: true, value: normalized, fieldErrors: {}, fieldErrorCodes: {} };
  } catch (error) {
    if (!isFieldValidationError(error)) {
      throw error;
    }

    return { ok: false, value: null, fieldErrors: error.fieldErrors, fieldErrorCodes: error.fieldErrorCodes || {} };
  }
}

export { validateOperationSection };
