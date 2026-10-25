import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  isJsonRestSchemaInstance,
  normalizeSingleSchemaDefinition
} from "@jskit-ai/kernel/shared/validators";

const OPERATION_SCHEMA_SECTION_NAMES = Object.freeze([
  "body",
  "query",
  "params",
  "input",
  "output"
]);

function createSchemaDefinition(schema, mode = "patch", {
  context = "schema definition"
} = {}) {
  return normalizeSingleSchemaDefinition({ schema, mode }, { context, defaultMode: "patch" });
}

function normalizeSchemaDefinitionLike(value, {
  context = "schema definition",
  defaultMode = "patch"
} = {}) {
  if (value == null) {
    return value;
  }

  const definition = isJsonRestSchemaInstance(value) ? { schema: value, mode: defaultMode } : value;
  return normalizeSingleSchemaDefinition(definition, { context, defaultMode });
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
