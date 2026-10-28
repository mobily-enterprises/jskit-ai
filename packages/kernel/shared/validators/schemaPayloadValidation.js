import { isRecord } from "../support/normalize.js";
import {
  executeJsonRestSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors
} from "./schemaDefinitions.js";

const SCHEMA_VALIDATION_FAILED_MESSAGE = "Schema validation failed.";

// fieldErrors keeps the English sentences; fieldErrorCodes ({ field: { code, params } })
// lets a client show the coded ones in the user's language. The HTTP error handler
// answers a 4xx one as a validation_failed response carrying both.
function buildSchemaValidationError({
  message = SCHEMA_VALIDATION_FAILED_MESSAGE,
  fieldErrors = null,
  fieldErrorCodes = null,
  errors = null,
  cause,
  statusCode = null
} = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  if (message === SCHEMA_VALIDATION_FAILED_MESSAGE) {
    error.messageCode = "kernel.validation.schemaFailed";
    error.messageParams = {};
  }
  if (Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599) {
    error.statusCode = statusCode;
  }
  if (isRecord(fieldErrors)) {
    const codes = isRecord(fieldErrorCodes) && Object.keys(fieldErrorCodes).length > 0 ? fieldErrorCodes : null;
    error.fieldErrors = fieldErrors;
    if (codes) {
      error.fieldErrorCodes = codes;
    }
    error.details = {
      ...(error.details || {}),
      fieldErrors,
      ...(codes ? { fieldErrorCodes: codes } : {})
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

  const { fieldErrors, fieldErrorCodes } = normalizeJsonRestSchemaFieldErrors(result.errors, schemaDefinition);
  if (Object.keys(fieldErrors).length > 0) {
    throw buildSchemaValidationError({
      fieldErrors,
      fieldErrorCodes,
      statusCode
    });
  }

  return result.validatedObject ?? payload;
}

// The field errors an error names (own or in details) and their codes, or null.
function errorFieldErrors(error) {
  const fieldErrors = isRecord(error?.fieldErrors)
    ? error.fieldErrors
    : isRecord(error?.details?.fieldErrors)
      ? error.details.fieldErrors
      : null;
  if (!fieldErrors) {
    return null;
  }
  const fieldErrorCodes = isRecord(error?.fieldErrorCodes)
    ? error.fieldErrorCodes
    : isRecord(error?.details?.fieldErrorCodes)
      ? error.details.fieldErrorCodes
      : null;
  return { fieldErrors, fieldErrorCodes };
}

// An error's field errors in createValidationError's input shape: the English
// string, or { code, params, message } for a field whose sentence has a code.
function codedFieldErrors(error) {
  const found = errorFieldErrors(error);
  if (!found) {
    return null;
  }

  const fieldErrorCodes = found.fieldErrorCodes || {};
  const entries = {};
  for (const [field, message] of Object.entries(found.fieldErrors)) {
    const coded = fieldErrorCodes[field];
    entries[field] = coded?.code ? { code: coded.code, params: coded.params, message } : message;
  }
  return entries;
}

export {
  buildSchemaValidationError,
  codedFieldErrors,
  errorFieldErrors,
  validateSchemaPayload
};
