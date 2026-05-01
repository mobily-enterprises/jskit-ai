import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SCHEMA_DEFINITION_MODES = new Set(["create", "replace", "patch"]);
const OPERATION_SCHEMA_SECTION_NAMES = Object.freeze([
  "body",
  "query",
  "params",
  "input",
  "output"
]);

function isJsonRestSchemaInstance(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    typeof value.create === "function" &&
    typeof value.replace === "function" &&
    typeof value.patch === "function" &&
    typeof value.toJsonSchema === "function";
}

function isSchemaDefinitionLike(value) {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (
      Object.hasOwn(value, "schema") ||
      Object.hasOwn(value, "mode")
    );
}

function resolveSchemaDefinitionMode(mode, {
  context = "schema definition.mode",
  defaultMode = "patch"
} = {}) {
  const fallbackMode = normalizeText(defaultMode).toLowerCase() || "patch";
  const normalizedMode = normalizeText(mode).toLowerCase() || fallbackMode;

  if (!SCHEMA_DEFINITION_MODES.has(normalizedMode)) {
    throw new TypeError(`${context} must be one of: create, replace, patch.`);
  }

  return normalizedMode;
}

function createSchemaDefinition(schema, mode = "patch", {
  context = "schema definition"
} = {}) {
  if (!isJsonRestSchemaInstance(schema)) {
    throw new TypeError(`${context}.schema must be a json-rest-schema schema instance.`);
  }

  return Object.freeze({
    schema,
    mode: resolveSchemaDefinitionMode(mode, {
      context: `${context}.mode`,
      defaultMode: "patch"
    })
  });
}

function normalizeSchemaDefinitionLike(value, {
  context = "schema definition",
  defaultMode = "patch"
} = {}) {
  if (value == null) {
    return value;
  }

  if (isJsonRestSchemaInstance(value)) {
    return createSchemaDefinition(value, defaultMode, { context });
  }

  if (!isSchemaDefinitionLike(value)) {
    throw new TypeError(
      `${context} must be a json-rest-schema schema instance or schema definition object.`
    );
  }

  const source = normalizeObject(value);

  if (!Object.hasOwn(source, "schema")) {
    throw new TypeError(`${context}.schema is required.`);
  }

  return createSchemaDefinition(
    source.schema,
    Object.hasOwn(source, "mode") ? source.mode : defaultMode,
    { context }
  );
}

function resolveDefaultOperationSchemaMode(sectionName, operation = {}) {
  const normalizedSectionName = normalizeText(sectionName).toLowerCase();
  if (normalizedSectionName === "output") {
    return "replace";
  }

  if (normalizedSectionName !== "body") {
    return "patch";
  }

  const normalizedMethod = normalizeText(operation?.method).toUpperCase();
  if (normalizedMethod === "POST") {
    return "create";
  }
  if (normalizedMethod === "PUT") {
    return "replace";
  }

  return "patch";
}

function normalizeOperationDefinition(operationName, operation = null, resourceMessages = null) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new TypeError(`defineResource operations.${operationName} must be an object.`);
  }

  const source = normalizeObject(operation);
  const normalizedOperation = {
    ...source
  };

  if (
    resourceMessages &&
    typeof resourceMessages === "object" &&
    !Array.isArray(resourceMessages) &&
    !Object.hasOwn(source, "messages")
  ) {
    normalizedOperation.messages = resourceMessages;
  }

  for (const sectionName of OPERATION_SCHEMA_SECTION_NAMES) {
    if (!Object.hasOwn(source, sectionName)) {
      continue;
    }

    const defaultMode = resolveDefaultOperationSchemaMode(sectionName, source);
    normalizedOperation[sectionName] = normalizeSchemaDefinitionLike(source[sectionName], {
      context: `defineResource operations.${operationName}.${sectionName}`,
      defaultMode
    });
  }

  return deepFreeze(normalizedOperation);
}

function normalizeResourceOperations(operations = null, resourceMessages = null) {
  const source = normalizeObject(operations);
  const normalizedOperations = {};

  for (const [operationName, operation] of Object.entries(source)) {
    const normalizedOperationName = normalizeText(operationName);
    if (!normalizedOperationName) {
      continue;
    }

    normalizedOperations[normalizedOperationName] = normalizeOperationDefinition(
      normalizedOperationName,
      operation,
      resourceMessages
    );
  }

  return Object.freeze(normalizedOperations);
}

function requireResourceNamespace(value, {
  context = "defineResource resource.namespace"
} = {}) {
  const normalizedNamespace = normalizeText(value);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

function defineResource(resource = {}) {
  const source = normalizeObject(resource);
  const normalizedMessages = Object.hasOwn(source, "messages")
    ? normalizeObject(source.messages)
    : null;

  return deepFreeze({
    ...source,
    namespace: requireResourceNamespace(source.namespace),
    ...(normalizedMessages ? { messages: normalizedMessages } : {}),
    operations: normalizeResourceOperations(source.operations, normalizedMessages)
  });
}

export {
  createSchemaDefinition,
  defineResource,
  normalizeSchemaDefinitionLike
};
