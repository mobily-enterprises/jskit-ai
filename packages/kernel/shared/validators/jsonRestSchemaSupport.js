import { isRecord, normalizeObject, normalizeText } from "../support/normalize.js";

const JSON_REST_SCHEMA_MODES = new Set(["create", "replace", "patch"]);
// Each json-rest-schema error code: the field `messages` key that overrides its
// English, and the code that English renders from. CUSTOM_VALIDATOR_FAILED has no
// code because the validator writes its own sentence.
const JSON_REST_SCHEMA_ERRORS = Object.freeze({
  REQUIRED: { messageKey: "required", code: "kernel.validation.field.required" },
  TYPE_CAST_FAILED: { messageKey: "default", code: "kernel.validation.field.typeCastFailed" },
  NOT_NULLABLE: { messageKey: "default", code: "kernel.validation.field.notNullable" },
  MIN_LENGTH: { messageKey: "minLength", code: "kernel.validation.field.minLength" },
  MAX_LENGTH: { messageKey: "maxLength", code: "kernel.validation.field.maxLength" },
  MIN_VALUE: { messageKey: "min", code: "kernel.validation.field.minValue" },
  MAX_VALUE: { messageKey: "max", code: "kernel.validation.field.maxValue" },
  PATTERN: { messageKey: "pattern", code: "kernel.validation.field.pattern" },
  ENUM_VALUE: { messageKey: "enum", code: "kernel.validation.field.enumValue" },
  FIELD_NOT_ALLOWED: { messageKey: "additionalProperties", code: "kernel.validation.field.notAllowed" },
  CUSTOM_VALIDATOR_FAILED: { messageKey: "validator", code: "" },
  STRICT_BOOLEAN: { messageKey: "default", code: "kernel.validation.field.strictBoolean" },
  RANGE_EXCEEDED: { messageKey: "default", code: "kernel.validation.field.rangeExceeded" },
  NOT_EMPTY: { messageKey: "default", code: "kernel.validation.field.notEmpty" }
});
const INVALID_VALUE = Object.freeze({ code: "kernel.validation.invalid", message: "Invalid value." });

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

function resolveJsonRestSchemaParentFieldMessages(schemaDefinition = null, fieldName = "") {
  const segments = normalizeText(fieldName).split(".").filter(Boolean);
  if (segments.length < 2) {
    return {};
  }

  segments.pop();
  return resolveJsonRestSchemaFieldMessages(schemaDefinition, segments.join("."));
}

// A field's `messages` entry is its English sentence, or { code, message, params }
// when the resource gives that sentence a code. Only the message is English.
function resolveFieldMessageOverride(messages, key) {
  const value = key ? messages[key] : undefined;
  if (typeof value === "string") {
    const message = normalizeText(value);
    return message ? { message } : null;
  }
  if (!isRecord(value)) {
    return null;
  }
  const message = normalizeText(value.message);
  if (!message) {
    return null;
  }
  const code = normalizeText(value.code);
  return code ? { message, code, params: normalizeObject(value.params) } : { message };
}

// One json-rest-schema field error as { message, code, params }: the English JSKIT
// shows today, plus the code and params that render it, when it has a code.
function resolveJsonRestSchemaFieldError(fieldName, entry, schemaDefinition = null) {
  const errorCode = normalizeText(entry?.code).toUpperCase();
  const known = JSON_REST_SCHEMA_ERRORS[errorCode] || {};
  const issueParams = normalizeObject(entry?.params);
  const directMessages = resolveJsonRestSchemaFieldMessages(schemaDefinition, fieldName);
  const messages = errorCode === "FIELD_NOT_ALLOWED" && Object.keys(directMessages).length < 1
    ? resolveJsonRestSchemaParentFieldMessages(schemaDefinition, fieldName)
    : directMessages;

  const override = resolveFieldMessageOverride(messages, known.messageKey) ||
    resolveFieldMessageOverride(messages, "default");
  if (override) {
    return override.code
      ? { message: override.message, code: override.code, params: { ...issueParams, ...override.params } }
      : { message: override.message };
  }

  const libraryMessage = normalizeText(entry?.message);
  if (libraryMessage) {
    return known.code ? { message: libraryMessage, code: known.code, params: issueParams } : { message: libraryMessage };
  }

  const rawCode = normalizeText(entry?.code);
  return rawCode ? { message: rawCode } : { ...INVALID_VALUE, params: {} };
}

// json-rest-schema errors as fieldErrors (English, exactly as before) and
// fieldErrorCodes ({ code, params } for every field whose sentence has a code).
function normalizeJsonRestSchemaFieldErrors(errors = {}, schemaDefinition = null) {
  const source = normalizeObject(errors);
  const fieldErrors = {};
  const fieldErrorCodes = {};

  for (const [fieldName, entry] of Object.entries(source)) {
    const normalizedFieldName = normalizeText(fieldName);
    if (!normalizedFieldName) {
      continue;
    }

    if (typeof entry === "string") {
      fieldErrors[normalizedFieldName] = entry;
      continue;
    }

    const { message, code, params } = resolveJsonRestSchemaFieldError(normalizedFieldName, entry, schemaDefinition);
    fieldErrors[normalizedFieldName] = message;
    if (code) {
      fieldErrorCodes[normalizedFieldName] = { code, params };
    }
  }

  return { fieldErrors, fieldErrorCodes };
}

export {
  isJsonRestSchemaInstance,
  resolveSchemaDefinitionMode,
  resolveSchemaDefinitionTransportSchema,
  normalizeJsonRestSchemaFieldErrors
};
