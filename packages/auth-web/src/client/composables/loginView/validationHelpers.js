import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { useJskitText } from "../../i18n.js";

function validateCommandSection(commandResource, section, payload) {
  if (!commandResource || !commandResource.operation) {
    return {
      ok: true,
      value: payload,
      fieldErrors: {}
    };
  }

  return validateOperationSection({
    operation: commandResource.operation,
    section,
    value: payload
  });
}

// Field messages in the user's language when the validator sent their codes.
function validationFieldMessages(validationResult) {
  return validationResult && !validationResult.ok ? useJskitText().fieldErrorMessages(validationResult) : {};
}

function resolveValidationMessage(validationResult, fallbackMessage = "") {
  if (!validationResult || validationResult.ok) {
    return "";
  }

  const firstFieldError = Object.values(validationFieldMessages(validationResult))
    .find((entry) => String(entry || "").trim().length > 0);
  if (firstFieldError) {
    return String(firstFieldError);
  }

  return String(fallbackMessage || useJskitText().t("jskit.errors.validation_failed"));
}

function resolveFieldValidationMessage(validationResult, fieldName = "") {
  return String(validationFieldMessages(validationResult)[fieldName] || "").trim();
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
