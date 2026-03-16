import { normalizeText } from "../../shared/support/normalize.js";
import { resolveServiceRegistrations } from "./serviceRegistration.js";

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function toCatalogKey(serviceToken, methodName) {
  const token = normalizeText(serviceToken).toLowerCase();
  const method = normalizeText(methodName).toLowerCase();
  if (!token || !method) {
    return "";
  }

  return `${token}.${method}`;
}

function extractJsonSchema(validator) {
  if (!validator || typeof validator !== "object" || Array.isArray(validator)) {
    return null;
  }

  const schema = validator.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }

  return schema;
}

function createServiceSchemaCatalog(scope) {
  const registrations = resolveServiceRegistrations(scope);
  const entries = [];
  const byKey = new Map();

  for (const registration of registrations) {
    const serviceToken = normalizeText(registration?.serviceToken);
    if (!serviceToken) {
      continue;
    }

    const schemas = normalizePlainObject(registration?.metadata?.schemas);
    for (const [methodName, spec] of Object.entries(schemas)) {
      const normalizedMethodName = normalizeText(methodName);
      if (!normalizedMethodName) {
        continue;
      }

      const schemaSpec = normalizePlainObject(spec);
      const inputValidator = normalizePlainObject(schemaSpec.input);
      const outputValidator = normalizePlainObject(schemaSpec.output);
      const inputSchema = extractJsonSchema(inputValidator);
      const outputSchema = extractJsonSchema(outputValidator);
      const entry = Object.freeze({
        serviceToken,
        methodName: normalizedMethodName,
        key: `${serviceToken}.${normalizedMethodName}`,
        description: normalizeText(schemaSpec.description),
        inputValidator: Object.keys(inputValidator).length > 0 ? inputValidator : null,
        outputValidator: Object.keys(outputValidator).length > 0 ? outputValidator : null,
        inputSchema,
        outputSchema
      });

      entries.push(entry);

      const catalogKey = toCatalogKey(serviceToken, normalizedMethodName);
      if (catalogKey) {
        byKey.set(catalogKey, entry);
      }
    }
  }

  const sortedEntries = Object.freeze(
    entries.sort((left, right) => left.key.localeCompare(right.key))
  );

  function getServiceMethodSchema(serviceToken, methodName) {
    const key = toCatalogKey(serviceToken, methodName);
    if (!key) {
      return null;
    }

    return byKey.get(key) || null;
  }

  function listServiceMethodSchemas() {
    return sortedEntries;
  }

  return Object.freeze({
    getServiceMethodSchema,
    listServiceMethodSchemas
  });
}

export {
  createServiceSchemaCatalog
};
