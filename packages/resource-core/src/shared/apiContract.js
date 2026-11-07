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

function resolveDefaultOperationSchemaMode(sectionName, operation) {
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

function normalizeOperationDefinition(operationName, operation = null, contractMessages = null) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new TypeError(`defineApiContract operations.${operationName} must be an object.`);
  }

  const source = normalizeObject(operation);
  const normalizedOperation = {
    ...source
  };

  if (
    contractMessages &&
    typeof contractMessages === "object" &&
    !Array.isArray(contractMessages) &&
    !Object.hasOwn(source, "messages")
  ) {
    normalizedOperation.messages = contractMessages;
  }

  for (const sectionName of OPERATION_SCHEMA_SECTION_NAMES) {
    if (!Object.hasOwn(source, sectionName)) {
      continue;
    }

    const defaultMode = resolveDefaultOperationSchemaMode(sectionName, source);
    normalizedOperation[sectionName] = normalizeSchemaDefinitionLike(source[sectionName], {
      context: `defineApiContract operations.${operationName}.${sectionName}`,
      defaultMode
    });
  }

  return deepFreeze(normalizedOperation);
}

function normalizeContractOperations(operations = null, contractMessages = null) {
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
      contractMessages
    );
  }

  return Object.freeze(normalizedOperations);
}

function requireContractNamespace(value, {
  context = "defineApiContract namespace"
} = {}) {
  const normalizedNamespace = normalizeText(value);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

/**
 * An HTTP operations contract that is not a table: a namespace, its messages,
 * and operations with body, query, params, input and output schemas. A table's
 * data is described by defineTableResource, and its optional CRUD surface by
 * defineCrudContract.
 * @param {Record<string, any>} [contract]
 */
function defineApiContract(contract = {}) {
  const source = normalizeObject(contract);
  const normalizedMessages = Object.hasOwn(source, "messages")
    ? normalizeObject(source.messages)
    : null;

  return deepFreeze({
    ...source,
    namespace: requireContractNamespace(source.namespace),
    ...(normalizedMessages ? { messages: normalizedMessages } : {}),
    operations: normalizeContractOperations(source.operations, normalizedMessages)
  });
}

export {
  createSchemaDefinition,
  defineApiContract,
  normalizeSchemaDefinitionLike
};
