/**
 * The messages a resource's operations show when their input fails validation:
 * validation is a message key the client renders; apiValidation is the API's
 * English with its code.
 */
const OPERATION_MESSAGES = Object.freeze({
  validation: "jskit.workspaces.feedback.validationFailed",
  apiValidation: Object.freeze({ code: "validation_failed", message: "Validation failed." })
});

export { OPERATION_MESSAGES };
