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

function requireJsonRestSchemaInstance(schemaDefinition = null, {
  context = "schema definition.schema"
} = {}) {
  const schema = normalizeObject(schemaDefinition).schema;
  if (!isJsonRestSchemaInstance(schema)) {
    throw new TypeError(`${context} must be a json-rest-schema schema instance.`);
  }

  return schema;
}

function resolveSchemaDefinitionMode(schemaDefinition = null, {
  defaultMode = "create",
  context = "schema definition.mode"
} = {}) {
  const source = normalizeObject(schemaDefinition);
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

function resolveSchemaDefinitionTransportSchema(schemaDefinition = null, options = {}) {
  const schema = requireJsonRestSchemaInstance(schemaDefinition, {
    context: `${options?.context || "schema definition"}.schema`
  });
  const mode = resolveSchemaDefinitionMode(schemaDefinition, options);
  return schema.toJsonSchema({ mode });
}

function executeSchemaDefinition(schemaDefinition = null, payload, options = {}) {
  const schema = requireJsonRestSchemaInstance(schemaDefinition, {
    context: `${options?.context || "schema definition"}.schema`
  });
  const mode = resolveSchemaDefinitionMode(schemaDefinition, options);
  return schema[mode](payload);
}

function resolveJsonRestSchemaFieldMessages(schemaDefinition = null, fieldName = "") {
  const normalizedFieldName = normalizeText(fieldName);
  if (!normalizedFieldName) {
    return {};
  }

  const source = normalizeObject(schemaDefinition);
  if (!isJsonRestSchemaInstance(source.schema)) {
    return {};
  }

  return normalizeObject(source.schema.getFieldMessages(normalizedFieldName));
}

function resolveJsonRestSchemaFieldErrorMessage(fieldName, entry, schemaDefinition = null) {
  const messages = resolveJsonRestSchemaFieldMessages(schemaDefinition, fieldName);
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

function normalizeJsonRestSchemaFieldErrors(errors = {}, schemaDefinition = null) {
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

    const message = resolveJsonRestSchemaFieldErrorMessage(normalizedFieldName, entry, schemaDefinition);
    fieldErrors[normalizedFieldName] = message || "Invalid value.";
  }

  return fieldErrors;
}

export {
  isJsonRestSchemaInstance,
  resolveSchemaDefinitionMode,
  resolveSchemaDefinitionTransportSchema,
  executeSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors
};
