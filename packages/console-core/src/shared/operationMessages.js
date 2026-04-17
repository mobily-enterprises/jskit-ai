function createOperationMessages({
  validationMessage = "Validation failed.",
  apiValidationMessage = validationMessage
} = {}) {
  const validation = String(validationMessage || "Validation failed.");
  const apiValidation = String(apiValidationMessage || validation || "Validation failed.");

  return Object.freeze({
    validation,
    apiValidation
  });
}

export {
  createOperationMessages
};
