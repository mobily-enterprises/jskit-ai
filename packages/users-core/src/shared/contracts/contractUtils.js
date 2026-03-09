function createOperationMessages({
  fields = {},
  keywords = {},
  defaultMessage = "Invalid value.",
  validationMessage = "Validation failed."
} = {}) {
  return Object.freeze({
    apiValidation: String(validationMessage || "Validation failed."),
    fields: Object.freeze({
      ...(fields && typeof fields === "object" ? fields : {})
    }),
    keywords: Object.freeze({
      additionalProperties: "Unexpected field.",
      ...(keywords && typeof keywords === "object" ? keywords : {})
    }),
    default: String(defaultMessage || "Invalid value.")
  });
}

export {
  createOperationMessages
};
