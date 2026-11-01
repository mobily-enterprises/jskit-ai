import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  buildRepositoryColumnMetadata,
  deriveRepositoryMappingFromResource,
  requireCrudTableName,
  resolveColumnName,
  resolveCrudIdColumn
} from "../repositorySupport.js";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";
import { buildCrudLookupRuntime } from "./lookupHydration.js";
import { CRUD_FIELD_STORAGE_COLUMN } from "@jskit-ai/resource-crud-core/shared/crudFieldContract";
import { resolveListRuntimeConfig } from "./listControls.js";

const REPOSITORY_OPERATION_KEYS = Object.freeze([
  "read",
  "list",
  "findById",
  "listByIds",
  "create",
  "updateById",
  "deleteById"
]);
const REPOSITORY_OPERATION_STAGE_KEYS = Object.freeze({
  read: ["applyQuery"],
  list: ["applyQuery"],
  findById: ["applyQuery"],
  listByIds: ["applyQuery"],
  create: ["preparePayload", "prepareInsertPayload", "applyQuery"],
  updateById: ["preparePatch", "applyQuery"],
  deleteById: ["applyQuery"]
});

function requireCrudRepositoryOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("createCrudResourceRuntime requires repository options object when provided.");
  }

  return value;
}

function resolveRepositoryDefaults(resource, repositoryMapping, { context }) {
  const resourceName = normalizeText(resource.namespace);
  const tableName = normalizeText(resource.tableName) || resourceName;
  if (!tableName) {
    throw new TypeError(`${context} requires resource.tableName or resource.namespace.`);
  }

  const idColumn = normalizeText(resource.idColumn) || resolveColumnName("id", repositoryMapping.columnOverrides) || "id";
  const createdAtColumn = repositoryMapping.outputKeys.includes("createdAt") &&
    repositoryMapping.fieldStorageByKey.createdAt === CRUD_FIELD_STORAGE_COLUMN
    ? resolveColumnName("createdAt", repositoryMapping.columnOverrides)
    : "";
  const updatedAtColumn = repositoryMapping.outputKeys.includes("updatedAt") &&
    repositoryMapping.fieldStorageByKey.updatedAt === CRUD_FIELD_STORAGE_COLUMN
    ? resolveColumnName("updatedAt", repositoryMapping.columnOverrides)
    : "";

  return Object.freeze({
    tableName,
    idColumn,
    createdAtColumn,
    updatedAtColumn
  });
}

function normalizeCrudVirtualFieldHandlers(virtualFields = {}, repositoryMapping, { context }) {
  const expectedKeys = new Set(repositoryMapping.virtualOutputKeys);
  if (expectedKeys.size < 1) {
    if (virtualFields === null) {
      return Object.freeze([]);
    }
    if (!virtualFields || typeof virtualFields !== "object" || Array.isArray(virtualFields)) {
      throw new TypeError(`${context} virtualFields must be an object when provided.`);
    }
    if (Object.keys(virtualFields).length > 0) {
      throw new Error(
        `${context} virtualFields contains registrations, but the resource does not declare any storage.virtual fields.`
      );
    }
    return Object.freeze([]);
  }

  if (!virtualFields || typeof virtualFields !== "object" || Array.isArray(virtualFields)) {
    throw new TypeError(`${context} virtualFields must be an object.`);
  }

  const normalizedHandlers = [];
  const seenKeys = new Set();
  for (const [rawKey, handlerConfig] of Object.entries(virtualFields)) {
    const key = normalizeText(rawKey);
    if (!key || seenKeys.has(key)) {
      continue;
    }
    if (!expectedKeys.has(key)) {
      throw new Error(
        `${context} virtualFields["${key}"] is unknown; declare the field in the resource schema with storage.virtual true.`
      );
    }
    if (!handlerConfig || typeof handlerConfig !== "object" || Array.isArray(handlerConfig)) {
      throw new TypeError(`${context} virtualFields["${key}"] must be an object.`);
    }
    // readable-check: allow method-probe - input validation: an application's virtual field handler must have applyProjection()
    if (typeof handlerConfig.applyProjection !== "function") {
      throw new TypeError(`${context} virtualFields["${key}"].applyProjection must be a function.`);
    }

    seenKeys.add(key);
    normalizedHandlers.push(Object.freeze({
      key,
      alias: resolveColumnName(key, repositoryMapping.columnOverrides),
      applyProjection: handlerConfig.applyProjection
    }));
  }

  for (const key of expectedKeys) {
    if (!seenKeys.has(key)) {
      throw new Error(
        `${context} resource output field "${key}" is virtual but no repository runtime projection was registered.`
      );
    }
  }

  return Object.freeze(normalizedHandlers);
}

function resolveRecordOutputValidator(resource, { context }) {
  const output = resource.operations.view?.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new TypeError(`${context} requires operations.view.output.`);
  }
  const schema = resolveSchemaTransportSchemaDefinition(output, {
    context: `${context} operations.view.output`,
    defaultMode: "replace"
  });
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${context} requires operations.view.output to resolve to an object schema.`);
  }

  return output;
}

function resolveOperationBodyValidator(resource, operationKey, { context }) {
  const body = resource.operations[operationKey]?.body;
  if (body == null) {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError(`${context} operations.${operationKey}.body must be an object when provided.`);
  }

  return body;
}

function normalizeCrudRepositoryOperationStage(stage, stageLabel, { context }) {
  if (stage === undefined || stage === null) {
    return null;
  }
  if (typeof stage !== "function") {
    throw new TypeError(`${context} ${stageLabel} must be a function when provided.`);
  }
  return stage;
}

function normalizeCrudRepositoryOperationConfig(config, operationKey, { context }) {
  if (config === undefined || config === null) {
    return Object.freeze({});
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError(`${context} operations.${operationKey} must be an object when provided.`);
  }

  const allowedKeys = REPOSITORY_OPERATION_STAGE_KEYS[operationKey];
  const normalized = {};
  for (const [rawKey, rawValue] of Object.entries(config)) {
    const key = normalizeText(rawKey);
    if (!key) {
      continue;
    }
    if (!allowedKeys.includes(key)) {
      throw new TypeError(
        `${context} operations.${operationKey}.${key} is not supported. Allowed keys: ${allowedKeys.join(", ")}.`
      );
    }
    normalized[key] = normalizeCrudRepositoryOperationStage(
      rawValue,
      `operations.${operationKey}.${key}`,
      { context }
    );
  }

  return Object.freeze(normalized);
}

/**
 * Each repository operation's stages, with an entry for every operation, so a
 * stage is read as `operations.<operation>.<stage>` (undefined when not configured).
 * @param {unknown} sourceOperations The repository options' operations, when given.
 * @param {{ context: string }} labels
 */
function normalizeCrudRepositoryOperations(sourceOperations, { context }) {
  const source = sourceOperations ?? {};
  if (typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError(`${context} operations must be an object when provided.`);
  }

  const normalized = {};
  for (const operationKey of REPOSITORY_OPERATION_KEYS) {
    normalized[operationKey] = normalizeCrudRepositoryOperationConfig(
      source[operationKey],
      operationKey,
      { context }
    );
  }

  for (const rawKey of Object.keys(source)) {
    const key = normalizeText(rawKey);
    if (key && !REPOSITORY_OPERATION_KEYS.includes(key)) {
      throw new TypeError(
        `${context} operations.${key} is not supported. Allowed keys: ${REPOSITORY_OPERATION_KEYS.join(", ")}.`
      );
    }
  }

  return Object.freeze(normalized);
}

/**
 * What a records repository resolves once from its resource and options: the
 * error context, table and id column (the options' tableName and idColumn, else
 * the resource's), the field mapping, the input and output schemas, the list
 * controls, the lookups, each operation's stages and the virtual fields.
 * @param {import("../types.js").CrudResourceDefinition} resource
 * @param {object} repositoryOptions
 */
function buildCompiledCrudRepositoryRuntime(resource, repositoryOptions) {
  const sourceOptions = requireCrudRepositoryOptions(repositoryOptions);
  const context = normalizeText(sourceOptions.context) || "crudRepository";
  const repositoryMapping = deriveRepositoryMappingFromResource(resource, { context });
  const defaults = resolveRepositoryDefaults(resource, repositoryMapping, { context });
  const output = resolveRecordOutputValidator(resource, { context });
  const lookupRuntime = buildCrudLookupRuntime(resource, {
    outputKeys: repositoryMapping.outputKeys,
    context
  });
  const listRuntime = resolveListRuntimeConfig(sourceOptions.list, repositoryMapping.listSearchColumns, {
    idColumn: defaults.idColumn
  });
  const { selectColumns } = buildRepositoryColumnMetadata({
    outputKeys: repositoryMapping.columnBackedOutputKeys,
    writeKeys: repositoryMapping.writeKeys,
    columnOverrides: repositoryMapping.columnOverrides,
    fieldStorageByKey: repositoryMapping.fieldStorageByKey
  });
  const normalizedSelectColumns = Object.freeze(
    [...new Set([
      ...selectColumns,
      ...listRuntime.orderBy.map(({ column }) => column)
    ])]
  );

  return Object.freeze({
    context,
    resource,
    repositoryOptions: sourceOptions,
    tableName: requireCrudTableName(sourceOptions.tableName ?? defaults.tableName, { context }),
    idColumn: resolveCrudIdColumn(sourceOptions.idColumn, { fallback: defaults.idColumn }),
    defaults,
    input: Object.freeze({
      create: resolveOperationBodyValidator(resource, "create", { context }),
      patch: resolveOperationBodyValidator(resource, "patch", { context })
    }),
    selectColumns: normalizedSelectColumns,
    output,
    list: listRuntime,
    lookup: lookupRuntime,
    mapping: repositoryMapping,
    operations: normalizeCrudRepositoryOperations(sourceOptions.operations, { context }),
    virtualFields: normalizeCrudVirtualFieldHandlers(sourceOptions.virtualFields, repositoryMapping, { context })
  });
}

export {
  buildCompiledCrudRepositoryRuntime
};
