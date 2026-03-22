import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";

function validateCommandSection(commandResource, section, payload) {
  if (!commandResource || !commandResource.operation) {
    return {
      ok: true,
      fieldErrors: {},
      globalErrors: []
    };
  }

  return validateOperationSection({
    operation: commandResource.operation,
    section,
    value: payload
  });
}

function resolveValidationMessage(validationResult, fallbackMessage = "Validation failed.") {
  if (!validationResult || validationResult.ok) {
    return "";
  }

  const fieldErrors = validationResult.fieldErrors && typeof validationResult.fieldErrors === "object"
    ? validationResult.fieldErrors
    : {};
  const firstFieldError = Object.values(fieldErrors).find((entry) => String(entry || "").trim().length > 0);
  if (firstFieldError) {
    return String(firstFieldError);
  }

  const globalErrors = Array.isArray(validationResult.globalErrors) ? validationResult.globalErrors : [];
  const firstGlobalError = globalErrors.find((entry) => String(entry || "").trim().length > 0);
  if (firstGlobalError) {
    return String(firstGlobalError);
  }

  return String(fallbackMessage || "Validation failed.");
}

function resolveFieldValidationMessage(validationResult, fieldName = "") {
  if (!validationResult || validationResult.ok) {
    return "";
  }

  const fieldErrors = validationResult.fieldErrors && typeof validationResult.fieldErrors === "object"
    ? validationResult.fieldErrors
    : {};
  return String(fieldErrors[fieldName] || "").trim();
}

function ensureCommandSectionValid(commandResource, section, payload, fallbackMessage) {
  const validation = validateCommandSection(commandResource, section, payload);
  if (validation.ok) {
    return;
  }
  throw new Error(resolveValidationMessage(validation, fallbackMessage));
}

export {
  validateCommandSection,
  resolveValidationMessage,
  resolveFieldValidationMessage,
  ensureCommandSectionValid
};
