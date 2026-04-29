import {
  executeJsonRestSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors
} from "./schemaDefinitions.js";

function buildSchemaValidationError({
  message = "Schema validation failed.",
  fieldErrors = null,
  errors = null,
  cause,
  statusCode = null
} = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    error.statusCode = statusCode;
  }
  if (fieldErrors && typeof fieldErrors === "object") {
    error.fieldErrors = fieldErrors;
    error.details = {
      ...(error.details || {}),
      fieldErrors
    };
  } else if (errors !== null && errors !== undefined) {
    error.details = {
      ...(error.details || {}),
      errors
    };
  }

  return error;
}

function validateSchemaPayload(schemaDefinition, payload, {
  phase = "input",
  context = "schema definition",
  statusCode = null
} = {}) {
  if (schemaDefinition == null) {
    return payload;
  }

  const result = executeJsonRestSchemaDefinition(schemaDefinition, payload, {
    defaultMode: phase === "output" ? "replace" : "patch",
    context
  });

  if (!result) {
    throw new TypeError(`${context}.schema must be a json-rest-schema schema instance.`);
  }

  const fieldErrors = normalizeJsonRestSchemaFieldErrors(result?.errors, schemaDefinition);
  if (Object.keys(fieldErrors).length > 0) {
    throw buildSchemaValidationError({
      fieldErrors,
      statusCode
    });
  }

  return result?.validatedObject ?? payload;
}

export {
  buildSchemaValidationError,
  validateSchemaPayload
};
