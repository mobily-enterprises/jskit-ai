import { Check, Errors } from "typebox/value";
import { normalizeObject, normalizeText } from "../support/normalize.js";
import {
  executeJsonRestSchemaDefinition,
  hasJsonRestSchemaDefinition,
  isSchemaDefinitionSectionMap,
  listSchemaDefinitions,
  normalizeJsonRestSchemaFieldErrors,
  selectPayloadForSchemaDefinition
} from "./schemaDefinitions.js";

function normalizeSchemaValidationErrors(schema) {
  const errors = Array.isArray(schema?.errors) ? schema.errors : [];
  if (errors.length < 1) {
    return null;
  }

  const fieldErrors = {};
  for (const entry of errors) {
    const rawFieldPath = normalizeText(entry?.path || entry?.instancePath || entry?.field || "");
    const fieldPath = rawFieldPath
      ? rawFieldPath.replace(/^\//, "").replace(/\//g, ".")
      : "input";
    const message = normalizeText(entry?.message || "Invalid value.") || "Invalid value.";
    fieldErrors[fieldPath] = message;
  }

  return Object.keys(fieldErrors).length > 0 ? fieldErrors : null;
}

function normalizeTypeBoxValidationErrors(schema, payload) {
  const issues = Check(schema, payload) ? [] : [...Errors(schema, payload)];
  if (issues.length < 1) {
    return null;
  }

  return normalizeSchemaValidationErrors({
    errors: issues
  });
}

function buildSchemaValidationError({
  message = "Schema validation failed.",
  fieldErrors = null,
  errors = null,
  cause
} = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
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

function normalizeFunctionSchemaResult(result, payload, { context = "schema definition" } = {}) {
  const contextLabel = typeof context === "string" && context.trim()
    ? context.trim()
    : "schema definition";
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean") {
    throw new TypeError(`${contextLabel}: Schema validator must return { ok, value, errors } or throw.`);
  }

  if (result.ok) {
    if (Object.prototype.hasOwnProperty.call(result, "value")) {
      return result.value;
    }
    return payload;
  }

  if (Array.isArray(result.errors)) {
    const fieldErrors = normalizeSchemaValidationErrors({ errors: result.errors });
    if (fieldErrors) {
      throw buildSchemaValidationError({ fieldErrors });
    }
    throw buildSchemaValidationError({ errors: result.errors });
  }

  if (result.errors && typeof result.errors === "object") {
    throw buildSchemaValidationError({ fieldErrors: result.errors });
  }

  if (result.errors != null) {
    throw buildSchemaValidationError({ message: String(result.errors) });
  }

  throw buildSchemaValidationError();
}

async function validateSingleSchemaPayload(schemaDefinition, payload, {
  phase = "input",
  context = "schema definition"
} = {}) {
  if (schemaDefinition == null) {
    return payload;
  }

  const schema = schemaDefinition && typeof schemaDefinition === "object" && !Array.isArray(schemaDefinition) &&
    Object.prototype.hasOwnProperty.call(schemaDefinition, "schema")
    ? schemaDefinition.schema
    : schemaDefinition;

  if (typeof schema === "function") {
    const result = await schema(payload, { phase });
    return normalizeFunctionSchemaResult(result, payload, { context });
  }

  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${context}.schema must be a function or object.`);
  }

  if (hasJsonRestSchemaDefinition(schemaDefinition)) {
    const result = await executeJsonRestSchemaDefinition(schemaDefinition, payload, {
      defaultMode: phase === "output" ? "replace" : "patch",
      context: `${context}.mode`
    });
    const fieldErrors = normalizeJsonRestSchemaFieldErrors(result?.errors, schemaDefinition);
    if (Object.keys(fieldErrors).length > 0) {
      throw buildSchemaValidationError({ fieldErrors });
    }

    return result?.validatedObject ?? payload;
  }

  if (typeof schema.parse === "function") {
    return schema.parse(payload);
  }

  if (typeof schema.assert === "function") {
    const assertionResult = await schema.assert(payload);
    return assertionResult == null ? payload : assertionResult;
  }

  if (typeof schema.check === "function") {
    const valid = await schema.check(payload);
    if (!valid) {
      throw buildSchemaValidationError();
    }
    return payload;
  }

  if (typeof schema.validate === "function") {
    const valid = await schema.validate(payload);
    if (!valid) {
      throw buildSchemaValidationError({
        fieldErrors: normalizeSchemaValidationErrors(schema)
      });
    }
    return payload;
  }

  const fieldErrors = normalizeTypeBoxValidationErrors(schema, payload);
  if (!fieldErrors) {
    return payload;
  }

  throw buildSchemaValidationError({ fieldErrors });
}

async function validateSchemaPayload(schemaDefinition, payload, {
  phase = "input",
  context = "schema definition"
} = {}) {
  if (schemaDefinition == null) {
    return payload;
  }

  if (isSchemaDefinitionSectionMap(schemaDefinition)) {
    const source = normalizeObject(payload);
    const normalized = {};

    for (const [key, sectionDefinition] of Object.entries(schemaDefinition)) {
      normalized[key] = await validateSchemaPayload(sectionDefinition, source[key], {
        phase,
        context: `${context}.${key}`
      });
    }

    return normalized;
  }

  const definitions = listSchemaDefinitions(schemaDefinition);
  if (definitions.length > 1) {
    const source = normalizeObject(payload);
    let normalized = {};

    for (const [index, entry] of definitions.entries()) {
      const validated = await validateSchemaPayload(
        entry,
        selectPayloadForSchemaDefinition(entry, source, {
          context: `${context}[${index}]`,
          defaultMode: phase === "output" ? "replace" : "patch"
        }),
        {
          phase,
          context: `${context}[${index}]`
        }
      );
      normalized = {
        ...normalized,
        ...normalizeObject(validated)
      };
    }

    return normalized;
  }

  return validateSingleSchemaPayload(definitions[0] || schemaDefinition, payload, {
    phase,
    context
  });
}

export {
  buildSchemaValidationError,
  normalizeSchemaValidationErrors,
  normalizeTypeBoxValidationErrors,
  validateSingleSchemaPayload,
  validateSchemaPayload
};
