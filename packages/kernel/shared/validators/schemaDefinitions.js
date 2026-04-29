import { normalizeObject, normalizeText } from "../support/normalize.js";
import {
  executeJsonRestSchemaValidator,
  hasJsonRestSchemaValidator,
  normalizeJsonRestSchemaFieldErrors,
  resolveValidatorTransportSchema
} from "./jsonRestSchemaSupport.js";

function isSchemaDefinitionObject(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (
      Object.prototype.hasOwnProperty.call(value, "schema") ||
      Object.prototype.hasOwnProperty.call(value, "mode")
    );
}

function normalizeSingleSchemaDefinition(value, { context = "schema definition", defaultMode = "" } = {}) {
  if (value == null) {
    return null;
  }

  if (!isSchemaDefinitionObject(value)) {
    throw new TypeError(`${context} must be a schema definition object.`);
  }

  const source = normalizeObject(value);

  if (!Object.prototype.hasOwnProperty.call(source, "schema")) {
    throw new TypeError(`${context}.schema is required.`);
  }

  if (!hasJsonRestSchemaValidator(source)) {
    throw new TypeError(`${context}.schema must be a json-rest-schema schema instance.`);
  }

  const normalized = {
    schema: source.schema
  };

  const resolvedDefaultMode = normalizeText(defaultMode).toLowerCase();
  normalized.mode = source.mode == null
    ? (resolvedDefaultMode || "patch")
    : String(source.mode || "").trim().toLowerCase();

  return Object.freeze(normalized);
}

function normalizeSchemaDefinition(value, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  return normalizeSingleSchemaDefinition(value, {
    context,
    defaultMode
  });
}

function resolveSchemaTransportSchemaDefinition(value, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  const normalized = normalizeSchemaDefinition(value, {
    context,
    defaultMode
  });

  if (!normalized) {
    return undefined;
  }

  return resolveValidatorTransportSchema(normalized, {
    defaultMode: defaultMode || "patch",
    context: `${context}.mode`
  });
}

function resolveStructuredSchemaTransportSchema(value, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  return resolveSchemaTransportSchemaDefinition(value, {
    context,
    defaultMode
  });
}

function hasJsonRestSchemaDefinition(value) {
  if (!isSchemaDefinitionObject(value)) {
    return false;
  }

  try {
    return hasJsonRestSchemaValidator(normalizeSchemaDefinition(value));
  } catch {
    return false;
  }
}

function executeJsonRestSchemaDefinition(value, payload, {
  context = "schema definition",
  defaultMode = ""
} = {}) {
  const normalized = normalizeSchemaDefinition(value, {
    context,
    defaultMode
  });

  if (!normalized) {
    return null;
  }

  return executeJsonRestSchemaValidator(normalized, payload, {
    defaultMode: defaultMode || "patch",
    context: `${context}.mode`
  });
}

export {
  hasJsonRestSchemaDefinition,
  normalizeSingleSchemaDefinition,
  normalizeSchemaDefinition,
  resolveSchemaTransportSchemaDefinition,
  resolveStructuredSchemaTransportSchema,
  executeJsonRestSchemaDefinition,
  normalizeJsonRestSchemaFieldErrors
};
