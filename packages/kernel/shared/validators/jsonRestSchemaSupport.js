import { normalizeObject, normalizeText } from "../support/normalize.js";

const JSON_REST_SCHEMA_MODES = new Set(["create", "replace", "patch"]);
const JSON_REST_SCHEMA_ERROR_MESSAGE_KEYS = Object.freeze({
  REQUIRED: "required",
  TYPE_CAST_FAILED: "default",
  NOT_NULLABLE: "default",
  MIN_LENGTH: "minLength",
  MAX_LENGTH: "maxLength",
  MIN_VALUE: "min",
  MAX_VALUE: "max",
  PATTERN: "pattern",
  ENUM_VALUE: "enum",
  FIELD_NOT_ALLOWED: "additionalProperties",
  CUSTOM_VALIDATOR_FAILED: "default"
});

function isJsonRestSchemaInstance(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof value.create === "function" &&
    typeof value.replace === "function" &&
    typeof value.patch === "function" &&
    typeof value.toJsonSchema === "function";
}

function resolveValidatorSchemaSource(validator = null) {
  const source = normalizeObject(validator);
  if (Object.prototype.hasOwnProperty.call(source, "schema")) {
    return source.schema;
  }

  return validator;
}

function resolveValidatorSchemaMode(validator = null, { defaultMode = "create", context = "validator.mode" } = {}) {
  const source = normalizeObject(validator);
  const fallbackMode = normalizeText(defaultMode).toLowerCase() || "create";
  const rawMode = Object.prototype.hasOwnProperty.call(source, "mode")
    ? normalizeText(source.mode).toLowerCase()
    : "";

  if (!rawMode) {
    return fallbackMode;
  }

  if (!JSON_REST_SCHEMA_MODES.has(rawMode)) {
    throw new TypeError(`${context} must be one of: create, replace, patch.`);
  }

  return rawMode;
}

function hasJsonRestSchemaValidator(validator = null) {
  return isJsonRestSchemaInstance(resolveValidatorSchemaSource(validator));
}

function resolveValidatorTransportSchema(validator = null, options = {}) {
  const schema = resolveValidatorSchemaSource(validator);
  if (!isJsonRestSchemaInstance(schema)) {
    return schema;
  }

  const mode = resolveValidatorSchemaMode(validator, options);
  return schema.toJsonSchema({ mode });
}

async function executeJsonRestSchemaValidator(validator = null, payload, options = {}) {
  const schema = resolveValidatorSchemaSource(validator);
  if (!isJsonRestSchemaInstance(schema)) {
    return null;
  }

  const mode = resolveValidatorSchemaMode(validator, options);
  return schema[mode](payload);
}

function executeJsonRestSchemaValidatorSync(validator = null, payload, options = {}) {
  const schema = resolveValidatorSchemaSource(validator);
  if (!isJsonRestSchemaInstance(schema)) {
    return null;
  }

  const mode = resolveValidatorSchemaMode(validator, options);
  return schema[mode](payload);
}

function resolveJsonRestSchemaFieldMessages(validator = null, fieldName = "") {
  const normalizedFieldName = normalizeText(fieldName);
  if (!normalizedFieldName) {
    return {};
  }

  const schema = resolveValidatorSchemaSource(validator);
  if (!isJsonRestSchemaInstance(schema)) {
    return {};
  }

  return normalizeObject(schema?.structure?.[normalizedFieldName]?.messages);
}

function resolveJsonRestSchemaFieldErrorMessage(fieldName, entry, validator = null) {
  const messages = resolveJsonRestSchemaFieldMessages(validator, fieldName);
  const errorCode = normalizeText(entry?.code).toUpperCase();
  const messageKey = JSON_REST_SCHEMA_ERROR_MESSAGE_KEYS[errorCode];

  if (messageKey && typeof messages[messageKey] === "string") {
    const overrideMessage = normalizeText(messages[messageKey]);
    if (overrideMessage) {
      return overrideMessage;
    }
  }

  if (typeof messages.default === "string") {
    const defaultMessage = normalizeText(messages.default);
    if (defaultMessage) {
      return defaultMessage;
    }
  }

  return normalizeText(entry?.message || entry?.code || "Invalid value.");
}

function normalizeJsonRestSchemaFieldErrors(errors = {}, validator = null) {
  const source = normalizeObject(errors);
  const fieldErrors = {};

  for (const [fieldName, entry] of Object.entries(source)) {
    const normalizedFieldName = normalizeText(fieldName);
    if (!normalizedFieldName) {
      continue;
    }

    if (typeof entry === "string") {
      fieldErrors[normalizedFieldName] = entry;
      continue;
    }

    const message = resolveJsonRestSchemaFieldErrorMessage(normalizedFieldName, entry, validator);
    fieldErrors[normalizedFieldName] = message || "Invalid value.";
  }

  return fieldErrors;
}

export {
  isJsonRestSchemaInstance,
  hasJsonRestSchemaValidator,
  resolveValidatorSchemaSource,
  resolveValidatorSchemaMode,
  resolveValidatorTransportSchema,
  executeJsonRestSchemaValidator,
  executeJsonRestSchemaValidatorSync,
  normalizeJsonRestSchemaFieldErrors
};
