import {
  createWithTransaction,
  resolveInsertedRecordId,
  toInsertDateTime
} from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { AppError, createValidationError } from "@jskit-ai/kernel/server/runtime/errors";
import { isRecord, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { Check, Errors } from "typebox/value";
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  buildRepositoryColumnMetadata,
  deriveRepositoryMappingFromResource,
  normalizeCrudListLimit,
  requireCrudTableName,
  applyCrudListQueryFilters,
  buildWritePayload,
  mapRecordRow,
  resolveColumnName,
  resolveCrudIdColumn
} from "../repositorySupport.js";
import {
  createCrudLookupRuntime,
  hydrateCrudLookupRecords
} from "./lookupHydration.js";
import { CRUD_FIELD_REPOSITORY_STORAGE_COLUMN } from "../../shared/crudFieldMetaSupport.js";

const LIST_ORDER_DIRECTION_ASC = "asc";
const LIST_ORDER_DIRECTION_DESC = "desc";
const LIST_ORDER_NULLS_FIRST = "first";
const LIST_ORDER_NULLS_LAST = "last";
const ORDERED_LIST_CURSOR_VALUE_TYPE_KEY = "__jskitCursorValueType";
const ORDERED_LIST_CURSOR_VALUE_KEY = "value";
const ORDERED_LIST_CURSOR_VALUE_TYPE_DATE = "date";
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

function requireCrudRecordId(value, { context = "crudRepository" } = {}) {
  const recordId = normalizeRecordId(value, { fallback: null });
  if (!recordId) {
    throw new TypeError(`${context} requires recordId.`);
  }
  return recordId;
}

function requireCrudRepositoryOptions(value = {}, { context = "crudRepository" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${context} requires repository options object when provided.`);
  }

  return value;
}

function resolveRepositoryDefaults(resource = {}, repositoryMapping = {}, { context = "crudRepository" } = {}) {
  const resourceName = normalizeText(resource.namespace);
  const tableName = normalizeText(resource.tableName) || resourceName;
  if (!tableName) {
    throw new TypeError(`${context} requires resource.tableName or resource.namespace.`);
  }

  const idColumn = normalizeText(resource.idColumn) || resolveColumnName("id", repositoryMapping.columnOverrides) || "id";
  const createdAtColumn = repositoryMapping.outputKeys.includes("createdAt") &&
    repositoryMapping.fieldStorageByKey?.createdAt === CRUD_FIELD_REPOSITORY_STORAGE_COLUMN
    ? resolveColumnName("createdAt", repositoryMapping.columnOverrides)
    : "";
  const updatedAtColumn = repositoryMapping.outputKeys.includes("updatedAt") &&
    repositoryMapping.fieldStorageByKey?.updatedAt === CRUD_FIELD_REPOSITORY_STORAGE_COLUMN
    ? resolveColumnName("updatedAt", repositoryMapping.columnOverrides)
    : "";

  return Object.freeze({
    tableName,
    idColumn,
    createdAtColumn,
    updatedAtColumn
  });
}

function normalizeCrudVirtualFieldHandlers(
  virtualFields = {},
  repositoryMapping = {},
  { context = "crudRepository" } = {}
) {
  const expectedKeys = new Set(
    (Array.isArray(repositoryMapping?.virtualOutputKeys) ? repositoryMapping.virtualOutputKeys : [])
      .map((key) => normalizeText(key))
      .filter(Boolean)
  );
  if (expectedKeys.size < 1) {
    if (virtualFields === null || virtualFields === undefined) {
      return Object.freeze([]);
    }
    if (!virtualFields || typeof virtualFields !== "object" || Array.isArray(virtualFields)) {
      throw new TypeError(`${context} virtualFields must be an object when provided.`);
    }
    if (Object.keys(virtualFields).length > 0) {
      throw new Error(
        `${context} virtualFields contains registrations, but the resource does not declare any repository.storage "virtual" fields.`
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
        `${context} virtualFields["${key}"] is unknown; declare the field in resource.fieldMeta with repository.storage "virtual".`
      );
    }
    if (!handlerConfig || typeof handlerConfig !== "object" || Array.isArray(handlerConfig)) {
      throw new TypeError(`${context} virtualFields["${key}"] must be an object.`);
    }
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

function applyCrudRepositoryVirtualProjections(
  dbQuery,
  runtime = {},
  { knex, tableName } = {}
) {
  const virtualFields = Array.isArray(runtime?.virtualFields) ? runtime.virtualFields : [];
  if (virtualFields.length < 1) {
    return dbQuery;
  }

  for (const virtualField of virtualFields) {
    virtualField.applyProjection(dbQuery, {
      knex,
      tableName,
      alias: virtualField.alias,
      fieldKey: virtualField.key
    });
  }

  return dbQuery;
}

function normalizeSearchColumns(searchColumns = [], fallbackColumns = []) {
  const normalizedConfiguredColumns = (Array.isArray(searchColumns) ? searchColumns : [])
    .map((columnName) => String(columnName || "").trim())
    .filter(Boolean);

  if (normalizedConfiguredColumns.length > 0) {
    return Object.freeze([...new Set(normalizedConfiguredColumns)]);
  }

  return Object.freeze(
    (Array.isArray(fallbackColumns) ? fallbackColumns : [])
      .map((columnName) => String(columnName || "").trim())
      .filter(Boolean)
  );
}

function normalizeListOrderDirection(value = LIST_ORDER_DIRECTION_ASC) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return LIST_ORDER_DIRECTION_ASC;
  }
  if (normalized === LIST_ORDER_DIRECTION_ASC || normalized === LIST_ORDER_DIRECTION_DESC) {
    return normalized;
  }

  throw new TypeError(`crudRepository list.orderBy direction must be "${LIST_ORDER_DIRECTION_ASC}" or "${LIST_ORDER_DIRECTION_DESC}".`);
}

function normalizeListOrderNulls(value = LIST_ORDER_NULLS_LAST) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return LIST_ORDER_NULLS_LAST;
  }
  if (normalized === LIST_ORDER_NULLS_FIRST || normalized === LIST_ORDER_NULLS_LAST) {
    return normalized;
  }

  throw new TypeError(`crudRepository list.orderBy nulls must be "${LIST_ORDER_NULLS_FIRST}" or "${LIST_ORDER_NULLS_LAST}".`);
}

function normalizeListOrderBy(orderBy = [], { idColumn = "id" } = {}) {
  const sourceEntries = Array.isArray(orderBy)
    ? orderBy
    : orderBy === null || orderBy === undefined
      ? []
      : [orderBy];
  const normalizedIdColumn = normalizeText(idColumn) || "id";
  const normalizedOrderBy = [];
  const seenColumns = new Set();

  for (const rawEntry of sourceEntries) {
    const sourceEntry = typeof rawEntry === "string"
      ? { column: rawEntry }
      : rawEntry;
    if (!sourceEntry || typeof sourceEntry !== "object" || Array.isArray(sourceEntry)) {
      throw new TypeError("crudRepository list.orderBy entries must be objects or column strings.");
    }

    const column = normalizeText(sourceEntry.column);
    if (!column) {
      throw new TypeError("crudRepository list.orderBy entries require column.");
    }
    if (seenColumns.has(column)) {
      continue;
    }

    seenColumns.add(column);
    normalizedOrderBy.push(
      Object.freeze({
        column,
        direction: normalizeListOrderDirection(sourceEntry.direction),
        nulls: normalizeListOrderNulls(sourceEntry.nulls)
      })
    );
  }

  if (normalizedOrderBy.length > 0 && !seenColumns.has(normalizedIdColumn)) {
    normalizedOrderBy.push(
      Object.freeze({
        column: normalizedIdColumn,
        direction: normalizedOrderBy[normalizedOrderBy.length - 1].direction,
        nulls: LIST_ORDER_NULLS_LAST
      })
    );
  }

  return Object.freeze(normalizedOrderBy);
}

function resolveListRuntimeConfig(list = {}, fallbackSearchColumns = [], { idColumn = "id" } = {}) {
  const parsedMaxLimit = Number(list?.maxLimit);
  const normalizedMaxLimit = Number.isInteger(parsedMaxLimit) && parsedMaxLimit > 0
    ? parsedMaxLimit
    : MAX_LIST_LIMIT;
  const normalizedDefaultLimit = normalizeCrudListLimit(list?.defaultLimit, {
    fallback: DEFAULT_LIST_LIMIT,
    max: normalizedMaxLimit
  });

  return Object.freeze({
    defaultLimit: normalizedDefaultLimit,
    maxLimit: normalizedMaxLimit,
    searchColumns: normalizeSearchColumns(list?.searchColumns, fallbackSearchColumns),
    orderBy: normalizeListOrderBy(list?.orderBy, { idColumn })
  });
}

function formatOutputValidationError(issue = {}) {
  const path = Array.isArray(issue.path) ? issue.path.join(".") : "";
  const value = issue.value;
  const message = normalizeText(issue.message) || "Invalid value";
  if (path) {
    return `${path}: ${message}`;
  }
  if (value !== undefined) {
    return `${message} (${JSON.stringify(value)})`;
  }
  return message;
}

function resolveRecordOutputValidator(resource = {}, { context = "crudRepository" } = {}) {
  const outputValidator = resource?.operations?.view?.outputValidator;
  if (!outputValidator || typeof outputValidator !== "object" || Array.isArray(outputValidator)) {
    throw new TypeError(`${context} requires operations.view.outputValidator.`);
  }
  if (!outputValidator.schema || typeof outputValidator.schema !== "object" || Array.isArray(outputValidator.schema)) {
    throw new TypeError(`${context} requires operations.view.outputValidator.schema.`);
  }

  return Object.freeze({
    schema: outputValidator.schema,
    normalize: typeof outputValidator.normalize === "function" ? outputValidator.normalize : null
  });
}

function resolveOperationBodyValidator(resource = {}, operationKey = "", { context = "crudRepository" } = {}) {
  const bodyValidator = resource?.operations?.[operationKey]?.bodyValidator;
  if (bodyValidator == null) {
    return Object.freeze({
      normalize: null
    });
  }
  if (!bodyValidator || typeof bodyValidator !== "object" || Array.isArray(bodyValidator)) {
    throw new TypeError(`${context} operations.${operationKey}.bodyValidator must be an object when provided.`);
  }

  return Object.freeze({
    normalize: typeof bodyValidator.normalize === "function" ? bodyValidator.normalize : null
  });
}

function extractExplicitFieldErrors(error) {
  if (isRecord(error?.fieldErrors)) {
    return error.fieldErrors;
  }

  if (isRecord(error?.details?.fieldErrors)) {
    return error.details.fieldErrors;
  }

  return null;
}

async function normalizeRepositoryInputPayload(
  runtime = {},
  payload = {},
  {
    operationKey = "create",
    phase = "crudCreate",
    action = "create",
    recordId = null,
    existingRecord = null,
    actionContextBase = {}
  } = {}
) {
  const inputValidator = operationKey === "patch"
    ? runtime.input?.patch
    : runtime.input?.create;
  const normalizedPayload = normalizeCrudRepositoryObjectInput(payload);

  if (typeof inputValidator?.normalize !== "function") {
    return normalizedPayload;
  }

  try {
    const nextPayload = await inputValidator.normalize(normalizedPayload, {
      phase,
      action,
      recordId,
      existingRecord,
      context: actionContextBase?.callOptions?.context,
      callOptions: actionContextBase?.callOptions,
      repositoryOptions: actionContextBase?.repositoryOptions
    });
    if (nextPayload === undefined) {
      return normalizedPayload;
    }
    if (!nextPayload || typeof nextPayload !== "object" || Array.isArray(nextPayload)) {
      throw new TypeError(
        `${runtime?.context || "crudRepository"} operations.${operationKey}.bodyValidator.normalize must return an object when it returns a value.`
      );
    }
    return nextPayload;
  } catch (error) {
    const explicitFieldErrors = extractExplicitFieldErrors(error);
    if (explicitFieldErrors) {
      throw createValidationError(explicitFieldErrors);
    }
    throw error;
  }
}

async function normalizeRepositoryOutputRecord(runtime = {}, record = {}, { operation = "list" } = {}) {
  const outputRuntime = runtime.output;
  let normalizedRecord = record;
  if (typeof outputRuntime.normalize === "function") {
    normalizedRecord = await outputRuntime.normalize(record, {
      phase: "crudRepositoryOutput",
      operation
    });
  }

  if (Check(outputRuntime.schema, normalizedRecord)) {
    return normalizedRecord;
  }

  const issues = [...Errors(outputRuntime.schema, normalizedRecord)];
  const formattedIssue = formatOutputValidationError(issues[0]);
  throw new TypeError(
    `${runtime?.context || "crudRepository"} ${operation} output validation failed: ${formattedIssue}.`
  );
}

function encodeOrderedListCursorValue(value = null) {
  if (value instanceof Date) {
    return {
      [ORDERED_LIST_CURSOR_VALUE_TYPE_KEY]: ORDERED_LIST_CURSOR_VALUE_TYPE_DATE,
      [ORDERED_LIST_CURSOR_VALUE_KEY]: value.toISOString()
    };
  }

  return value === undefined ? null : value;
}

function decodeOrderedListCursorValue(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value === undefined ? null : value;
  }

  const valueType = normalizeText(value[ORDERED_LIST_CURSOR_VALUE_TYPE_KEY]).toLowerCase();
  if (!valueType) {
    return value;
  }
  if (valueType !== ORDERED_LIST_CURSOR_VALUE_TYPE_DATE) {
    return value;
  }

  const normalizedValue = normalizeText(value[ORDERED_LIST_CURSOR_VALUE_KEY]);
  if (!normalizedValue) {
    throw new TypeError("Ordered list cursor date values require a non-empty value.");
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Ordered list cursor date values must be valid dates.");
  }

  return date;
}

function encodeOrderedListCursor(row = null, orderBy = []) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return null;
  }

  const normalizedOrderBy = Array.isArray(orderBy) ? orderBy : [];
  if (normalizedOrderBy.length < 1) {
    return null;
  }

  const values = normalizedOrderBy.map(({ column }) => (
    Object.hasOwn(row, column) && row[column] !== undefined
      ? encodeOrderedListCursorValue(row[column])
      : null
  ));

  return Buffer.from(JSON.stringify({ values }), "utf8").toString("base64url");
}

function decodeOrderedListCursor(cursor = "", orderBy = []) {
  const normalizedCursor = normalizeText(cursor);
  const normalizedOrderBy = Array.isArray(orderBy) ? orderBy : [];
  if (!normalizedCursor || normalizedOrderBy.length < 1) {
    return null;
  }

  try {
    const decoded = Buffer.from(normalizedCursor, "base64url").toString("utf8");
    const payload = JSON.parse(decoded);
    const values = Array.isArray(payload?.values) ? payload.values : null;
    if (!values || values.length !== normalizedOrderBy.length) {
      throw new AppError(400, "Invalid cursor.", {
        code: "INVALID_CURSOR"
      });
    }

    return values.map((value) => decodeOrderedListCursorValue(value));
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(400, "Invalid cursor.", {
      code: "INVALID_CURSOR"
    });
  }
}

function applyOrderedListCursorEquality(query, descriptor = {}, value = null) {
  if (value === null) {
    query.whereNull(descriptor.column);
    return;
  }

  query.where(descriptor.column, value);
}

function applyOrderedListCursorAfterBranch(query, descriptor = {}, value = null) {
  const operator = descriptor.direction === LIST_ORDER_DIRECTION_DESC ? "<" : ">";

  if (value === null) {
    if (descriptor.nulls === LIST_ORDER_NULLS_FIRST) {
      query.whereNotNull(descriptor.column);
      return true;
    }

    return false;
  }

  if (descriptor.nulls === LIST_ORDER_NULLS_LAST) {
    query.where((branchQuery) => {
      branchQuery.where(descriptor.column, operator, value);
      branchQuery.orWhereNull(descriptor.column);
    });
    return true;
  }

  query.where(descriptor.column, operator, value);
  return true;
}

function canApplyOrderedListCursorAfterBranch(descriptor = {}, value = null) {
  return !(value === null && descriptor.nulls === LIST_ORDER_NULLS_LAST);
}

function appendOrderedListCursorBranches(query, orderBy = [], cursorValues = [], index = 0, { useOr = false } = {}) {
  const descriptor = orderBy[index];
  if (!descriptor) {
    return false;
  }

  let addedBranch = false;
  const currentValue = cursorValues[index] ?? null;

  if (canApplyOrderedListCursorAfterBranch(descriptor, currentValue)) {
    const afterMethod = useOr === true ? "orWhere" : "where";
    query[afterMethod]((afterQuery) => {
      applyOrderedListCursorAfterBranch(afterQuery, descriptor, currentValue);
    });
    addedBranch = true;
  }

  if (index >= orderBy.length - 1) {
    return addedBranch;
  }

  const equalityMethod = useOr === true || addedBranch === true ? "orWhere" : "where";
  query[equalityMethod]((equalQuery) => {
    applyOrderedListCursorEquality(equalQuery, descriptor, currentValue);
    equalQuery.where((nestedQuery) => {
      appendOrderedListCursorBranches(nestedQuery, orderBy, cursorValues, index + 1);
    });
  });
  return true;
}

function applyOrderedListCursorFilter(query, { orderBy = [], cursor = "" } = {}) {
  const normalizedOrderBy = Array.isArray(orderBy) ? orderBy : [];
  const cursorValues = decodeOrderedListCursor(cursor, normalizedOrderBy);
  if (!cursorValues) {
    return query;
  }

  return query.where((cursorQuery) => {
    appendOrderedListCursorBranches(cursorQuery, normalizedOrderBy, cursorValues);
  });
}

function normalizeCrudRepositoryOperationStage(stage = null, stageLabel = "", { context = "crudRepository" } = {}) {
  if (stage === undefined || stage === null) {
    return null;
  }
  if (typeof stage !== "function") {
    throw new TypeError(`${context} ${stageLabel} must be a function when provided.`);
  }
  return stage;
}

function normalizeCrudRepositoryOperationConfig(config = {}, operationKey = "", { context = "crudRepository" } = {}) {
  if (config === undefined || config === null) {
    return Object.freeze({});
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError(`${context} operations.${operationKey} must be an object when provided.`);
  }

  const allowedKeys = REPOSITORY_OPERATION_STAGE_KEYS[operationKey] || [];
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

function normalizeCrudRepositoryOperations(sourceOperations = {}, { context = "crudRepository" } = {}) {
  if (sourceOperations === undefined || sourceOperations === null) {
    return Object.freeze({});
  }
  if (!sourceOperations || typeof sourceOperations !== "object" || Array.isArray(sourceOperations)) {
    throw new TypeError(`${context} operations must be an object when provided.`);
  }

  const normalized = {};
  for (const operationKey of REPOSITORY_OPERATION_KEYS) {
    normalized[operationKey] = normalizeCrudRepositoryOperationConfig(
      sourceOperations[operationKey],
      operationKey,
      { context }
    );
  }

  for (const rawKey of Object.keys(sourceOperations)) {
    const key = normalizeText(rawKey);
    if (key && !REPOSITORY_OPERATION_KEYS.includes(key)) {
      throw new TypeError(
        `${context} operations.${key} is not supported. Allowed keys: ${REPOSITORY_OPERATION_KEYS.join(", ")}.`
      );
    }
  }

  return Object.freeze(normalized);
}

function applyConfiguredQueryStage(
  dbQuery,
  stage = null,
  stageContext = {},
  { context = "crudRepository", stageKey = "applyQuery" } = {}
) {
  if (typeof stage !== "function") {
    return {
      queryBuilder: dbQuery
    };
  }

  const directResult = stage(dbQuery, stageContext);
  if (directResult === undefined || directResult === dbQuery) {
    return {
      queryBuilder: dbQuery
    };
  }

  if (isCrudRepositoryQueryBuilder(directResult)) {
    return {
      queryBuilder: directResult
    };
  }

  if (directResult && typeof directResult.then === "function") {
    return Promise.resolve(directResult).then((awaitedResult) => {
      if (awaitedResult === undefined || awaitedResult === dbQuery) {
        return {
          queryBuilder: dbQuery
        };
      }

      if (isCrudRepositoryQueryBuilder(awaitedResult)) {
        throw new TypeError(
          `${context} ${stageKey} cannot return a query builder asynchronously. Mutate the provided builder and return undefined instead.`
        );
      }

      throw new TypeError(
        `${context} ${stageKey} must return undefined, the provided query builder, or another query builder synchronously.`
      );
    });
  }

  return Promise.reject(new TypeError(
    `${context} ${stageKey} must return undefined, the provided query builder, or another query builder synchronously.`
  ));
}

function isCrudRepositoryQueryBuilder(value) {
  if (!value || (typeof value !== "object" && typeof value !== "function") || Array.isArray(value)) {
    return false;
  }

  return [
    "where",
    "whereIn",
    "select",
    "insert",
    "update",
    "delete",
    "del",
    "first",
    "modify"
  ].some((key) => typeof value[key] === "function");
}

function normalizeCrudRepositoryObjectInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

async function applyConfiguredObjectStage(
  payload = {},
  stage = null,
  stageContext = {},
  { context = "crudRepository", stageKey = "preparePayload" } = {}
) {
  const normalizedPayload = normalizeCrudRepositoryObjectInput(payload);
  if (typeof stage !== "function") {
    return normalizedPayload;
  }

  const nextPayload = await stage(normalizedPayload, stageContext);
  if (nextPayload === undefined) {
    return normalizedPayload;
  }

  if (!nextPayload || typeof nextPayload !== "object" || Array.isArray(nextPayload)) {
    throw new TypeError(`${context} ${stageKey} must return an object when it returns a value.`);
  }

  return nextPayload;
}

function applyOrderedListControls(dbQuery, orderBy = []) {
  let nextQuery = dbQuery;
  for (const descriptor of Array.isArray(orderBy) ? orderBy : []) {
    if (typeof nextQuery.orderByRaw === "function") {
      nextQuery = nextQuery.orderByRaw(
        descriptor.nulls === LIST_ORDER_NULLS_FIRST
          ? "?? is null desc"
          : "?? is null asc",
        [descriptor.column]
      );
    }
    nextQuery = nextQuery.orderBy(descriptor.column, descriptor.direction);
  }

  return nextQuery;
}

function enforceCrudRepositoryListControls(
  dbQuery,
  {
    idColumn = "id",
    limit = DEFAULT_LIST_LIMIT + 1,
    orderBy = []
  } = {}
) {
  let nextQuery = dbQuery;
  if (typeof nextQuery.clearOrder === "function") {
    nextQuery = nextQuery.clearOrder();
  }
  if (typeof nextQuery.clear === "function") {
    nextQuery = nextQuery.clear("limit");
  }

  const normalizedOrderBy = Array.isArray(orderBy) ? orderBy : [];
  if (normalizedOrderBy.length > 0) {
    return applyOrderedListControls(nextQuery, normalizedOrderBy)
      .limit(limit);
  }

  return nextQuery
    .orderBy(idColumn, "asc")
    .limit(limit);
}

function createCrudRepositoryActionContextBase(runtime, callOptions = {}) {
  return {
    runtime,
    repositoryOptions: runtime.repositoryOptions,
    callOptions,
    state: {}
  };
}

function createCompiledCrudRepositoryRuntime(resource = {}, repositoryOptions = {}) {
  const sourceOptions = requireCrudRepositoryOptions(repositoryOptions, {
    context: "createCrudResourceRuntime"
  });
  const context = normalizeText(sourceOptions.context) || "crudRepository";
  const repositoryMapping = deriveRepositoryMappingFromResource(resource, { context });
  const defaults = resolveRepositoryDefaults(resource, repositoryMapping, { context });
  const output = resolveRecordOutputValidator(resource, { context });
  const lookupRuntime = createCrudLookupRuntime(resource, {
    outputKeys: repositoryMapping.outputKeys
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

function resolveCrudRepositoryCall(runtime, knex, callOptions = {}) {
  const client = callOptions?.trx || knex;
  const tableName = requireCrudTableName(runtime.repositoryOptions?.tableName ?? runtime.defaults?.tableName, {
    context: runtime.context || "crudRepository"
  });
  const idColumn = resolveCrudIdColumn(runtime.repositoryOptions?.idColumn, {
    fallback: runtime.defaults?.idColumn || "id"
  });
  const visible = (queryBuilder) => applyVisibility(queryBuilder, callOptions.visibilityContext);

  return Object.freeze({
    client,
    tableName,
    idColumn,
    visible
  });
}

function applyCrudRepositoryReadLock(dbQuery, callOptions = {}) {
  if (callOptions?.forUpdate === true && typeof dbQuery.forUpdate === "function") {
    return dbQuery.forUpdate();
  }

  return dbQuery;
}

async function listRecords(runtime, knex, query = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedLimit = normalizeCrudListLimit(query?.limit, {
    fallback: runtime.list.defaultLimit,
    max: runtime.list.maxLimit
  });
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  const usesOrderedListCursor = runtime.list.orderBy.length > 0;
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);
  dbQuery = applyCrudRepositoryVirtualProjections(dbQuery, runtime, {
    knex: client,
    tableName
  });

  dbQuery = applyCrudListQueryFilters(dbQuery, {
    idColumn,
    cursor: query?.cursor,
    applyCursor: usesOrderedListCursor !== true,
    q: query?.q,
    searchColumns: runtime.list.searchColumns,
    parentFilters: query,
    parentFilterColumns: runtime.mapping.parentFilterColumns
  });
  if (usesOrderedListCursor) {
    dbQuery = applyOrderedListCursorFilter(dbQuery, {
      orderBy: runtime.list.orderBy,
      cursor: query?.cursor
    });
  }

  const readListStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.read?.applyQuery,
    {
      action: "list",
      query,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.read.applyQuery"
    }
  );
  dbQuery = readListStageResult.queryBuilder;
  const listStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.list?.applyQuery,
    {
      action: "list",
      query,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.list.applyQuery"
    }
  );
  dbQuery = listStageResult.queryBuilder;

  dbQuery = dbQuery.where(visible);
  dbQuery = applyCrudRepositoryReadLock(dbQuery, callOptions);
  dbQuery = enforceCrudRepositoryListControls(dbQuery, {
    idColumn,
    limit: normalizedLimit + 1,
    orderBy: runtime.list.orderBy
  });

  const rows = await dbQuery;
  const hasMore = rows.length > normalizedLimit;
  const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const items = [];
  for (const row of pageRows) {
    const mappedRecord = mapRecordRow(
      row,
      runtime.mapping.outputKeys,
      runtime.mapping.columnOverrides,
      { recordIdKeys: runtime.mapping.outputRecordIdKeys }
    );
    if (!mappedRecord) {
      continue;
    }

    items.push(await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
      operation: "list"
    }));
  }

  const hydratedItems = await hydrateCrudLookupRecords(items, {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: callOptions?.include,
    mode: "list",
    repositoryOptions: runtime.repositoryOptions,
    callOptions
  });

  const lastPageRow = pageRows[pageRows.length - 1] || null;
  const nextCursor = hasMore && lastPageRow
    ? (
        usesOrderedListCursor
          ? encodeOrderedListCursor(lastPageRow, runtime.list.orderBy)
          : String(lastPageRow[idColumn])
      )
    : null;

  return {
    items: hydratedItems,
    nextCursor
  };
}

async function findRecordById(runtime, knex, recordId, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.findById" });
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);
  dbQuery = applyCrudRepositoryVirtualProjections(dbQuery, runtime, {
    knex: client,
    tableName
  });

  const readFindStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.read?.applyQuery,
    {
      action: "findById",
      recordId,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.read.applyQuery"
    }
  );
  dbQuery = readFindStageResult.queryBuilder;
  const findStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.findById?.applyQuery,
    {
      action: "findById",
      recordId,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.findById.applyQuery"
    }
  );
  dbQuery = findStageResult.queryBuilder;

  dbQuery = dbQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });
  dbQuery = applyCrudRepositoryReadLock(dbQuery, callOptions);

  const row = await dbQuery.first();

  const mappedRecord = mapRecordRow(
    row,
    runtime.mapping.outputKeys,
    runtime.mapping.columnOverrides,
    { recordIdKeys: runtime.mapping.outputRecordIdKeys }
  );
  if (!mappedRecord) {
    return null;
  }

  const normalizedRecord = await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
    operation: "findById"
  });
  const hydrated = await hydrateCrudLookupRecords([normalizedRecord], {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: callOptions?.include,
    mode: "view",
    repositoryOptions: runtime.repositoryOptions,
    callOptions
  });

  return hydrated[0] || null;
}

async function listRecordsByIds(runtime, knex, ids = [], callOptions = {}) {
  const { client, tableName, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  const lookupValueKey = normalizeText(callOptions?.valueKey) || "id";
  if (!runtime.mapping.outputKeys.includes(lookupValueKey)) {
    throw new TypeError(
      `${runtime.context || "crudRepository"} listByIds requires valueKey "${lookupValueKey}" to exist in output schema.`
    );
  }
  if (runtime.mapping.fieldStorageByKey?.[lookupValueKey] !== CRUD_FIELD_REPOSITORY_STORAGE_COLUMN) {
    throw new TypeError(
      `${runtime.context || "crudRepository"} listByIds requires valueKey "${lookupValueKey}" to be column-backed.`
    );
  }
  const lookupColumn = resolveColumnName(lookupValueKey, runtime.mapping.columnOverrides);
  if (!lookupColumn) {
    throw new TypeError(`${runtime.context || "crudRepository"} listByIds requires a valid valueKey.`);
  }

  const normalizedIds = Array.isArray(ids)
    ? [...new Set(ids.map((value) => normalizeText(value)).filter(Boolean))]
    : [];
  if (normalizedIds.length < 1) {
    return [];
  }

  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);
  dbQuery = applyCrudRepositoryVirtualProjections(dbQuery, runtime, {
    knex: client,
    tableName
  });

  const readListByIdsStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.read?.applyQuery,
    {
      action: "listByIds",
      ids: normalizedIds,
      lookupValueKey,
      lookupColumn,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.read.applyQuery"
    }
  );
  dbQuery = readListByIdsStageResult.queryBuilder;
  const listByIdsStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations?.listByIds?.applyQuery,
    {
      action: "listByIds",
      ids: normalizedIds,
      lookupValueKey,
      lookupColumn,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.listByIds.applyQuery"
    }
  );
  dbQuery = listByIdsStageResult.queryBuilder;

  dbQuery = dbQuery
    .where(visible)
    .whereIn(lookupColumn, normalizedIds);
  dbQuery = applyCrudRepositoryReadLock(dbQuery, callOptions);

  const rows = await dbQuery;

  const records = [];
  for (const row of rows) {
    const mappedRecord = mapRecordRow(
      row,
      runtime.mapping.outputKeys,
      runtime.mapping.columnOverrides,
      { recordIdKeys: runtime.mapping.outputRecordIdKeys }
    );
    if (!mappedRecord) {
      continue;
    }

    records.push(await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
      operation: "listByIds"
    }));
  }

  const lookupInclude = callOptions?.include === undefined ? "none" : callOptions.include;
  return hydrateCrudLookupRecords(records, {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: lookupInclude,
    mode: "list",
    repositoryOptions: runtime.repositoryOptions,
    callOptions
  });
}

async function createRecord(runtime, knex, payload = {}, callOptions = {}) {
  const { client, tableName } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  let sourcePayload = await normalizeRepositoryInputPayload(runtime, payload, {
    operationKey: "create",
    phase: "crudCreate",
    action: "create",
    actionContextBase
  });
  sourcePayload = await applyConfiguredObjectStage(
    sourcePayload,
    runtime.operations?.create?.preparePayload,
    {
      action: "create",
      payload: sourcePayload,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.create.preparePayload"
    }
  );

  let insertPayload = buildWritePayload(
    sourcePayload,
    runtime.mapping.writeKeys,
    runtime.mapping.columnOverrides,
    {
      serializerByKey: runtime.mapping.writeSerializerByKey
    }
  );
  const timestamp = toInsertDateTime();
  if (runtime.defaults.createdAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.createdAtColumn)) {
    insertPayload[runtime.defaults.createdAtColumn] = timestamp;
  }
  if (runtime.defaults.updatedAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.updatedAtColumn)) {
    insertPayload[runtime.defaults.updatedAtColumn] = timestamp;
  }
  insertPayload = await applyConfiguredObjectStage(
    insertPayload,
    runtime.operations?.create?.prepareInsertPayload,
    {
      action: "create",
      payload: sourcePayload,
      insertPayload: {
        ...insertPayload
      },
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.create.prepareInsertPayload"
    }
  );

  const withOwners = applyVisibilityOwners(insertPayload, callOptions.visibilityContext);
  let createQuery = client(tableName);
  const createStageResult = await applyConfiguredQueryStage(
    createQuery,
    runtime.operations?.create?.applyQuery,
    {
      action: "create",
      payload: {
        ...withOwners
      },
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.create.applyQuery"
    }
  );
  createQuery = createStageResult.queryBuilder;

  const insertResult = await createQuery.insert(withOwners);
  const recordId = resolveInsertedRecordId(insertResult, { fallback: null });
  if (!recordId) {
    throw new Error("crudRepository.create could not resolve inserted id.");
  }

  return findRecordById(runtime, knex, recordId, {
    ...callOptions,
    trx: client,
    sourceOperation: "create"
  });
}

async function updateRecordById(runtime, knex, recordId, patch = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.updateById" });
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  const existingRecord = Object.hasOwn(callOptions, "existingRecord")
    ? callOptions.existingRecord
    : await findRecordById(runtime, knex, normalizedRecordId, {
        ...callOptions,
        trx: client,
        sourceOperation: "update"
      });
  let sourcePatch = await normalizeRepositoryInputPayload(runtime, patch, {
    operationKey: "patch",
    phase: "crudPatch",
    action: "update",
    recordId: normalizedRecordId,
    existingRecord,
    actionContextBase
  });
  sourcePatch = await applyConfiguredObjectStage(
    sourcePatch,
    runtime.operations?.updateById?.preparePatch,
    {
      action: "updateById",
      recordId,
      patch: sourcePatch,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.updateById.preparePatch"
    }
  );
  const dbPatch = buildWritePayload(
    sourcePatch,
    runtime.mapping.writeKeys,
    runtime.mapping.columnOverrides,
    {
      serializerByKey: runtime.mapping.writeSerializerByKey
    }
  );

  if (runtime.defaults.updatedAtColumn) {
    dbPatch[runtime.defaults.updatedAtColumn] = toInsertDateTime();
  }

  if (Object.keys(dbPatch).length < 1) {
    return findRecordById(runtime, knex, recordId, {
      ...callOptions,
      trx: client,
      sourceOperation: "update"
    });
  }

  let updateQuery = client(tableName);
  const updateStageResult = await applyConfiguredQueryStage(
    updateQuery,
    runtime.operations?.updateById?.applyQuery,
    {
      action: "updateById",
      recordId,
      patch: {
        ...dbPatch
      },
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.updateById.applyQuery"
    }
  );
  updateQuery = updateStageResult.queryBuilder;

  updateQuery = updateQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });

  await updateQuery.update(dbPatch);

  return findRecordById(runtime, knex, recordId, {
    ...callOptions,
    trx: client,
    sourceOperation: "update"
  });
}

async function deleteRecordById(runtime, knex, recordId, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.deleteById" });
  const actionContextBase = createCrudRepositoryActionContextBase(runtime, callOptions);
  const existing = await findRecordById(runtime, knex, recordId, {
    ...callOptions,
    include: "none",
    trx: client
  });
  if (!existing) {
    return null;
  }

  let deleteQuery = client(tableName);
  const deleteStageResult = await applyConfiguredQueryStage(
    deleteQuery,
    runtime.operations?.deleteById?.applyQuery,
    {
      action: "deleteById",
      recordId,
      existing,
      ...actionContextBase
    },
    {
      context: runtime.context,
      stageKey: "operations.deleteById.applyQuery"
    }
  );
  deleteQuery = deleteStageResult.queryBuilder;

  deleteQuery = deleteQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });

  await deleteQuery.delete();

  return {
    id: existing.id,
    deleted: true
  };
}

function createCrudResourceRuntime(resource = {}, knex, repositoryOptions = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("createCrudResourceRuntime requires knex.");
  }

  const runtime = createCompiledCrudRepositoryRuntime(resource, repositoryOptions);
  const withTransaction = createWithTransaction(knex);

  return Object.freeze({
    withTransaction,
    async list(query = {}, callOptions = {}) {
      return listRecords(runtime, knex, query, callOptions);
    },
    async findById(recordId, callOptions = {}) {
      return findRecordById(runtime, knex, recordId, callOptions);
    },
    async listByIds(ids = [], callOptions = {}) {
      return listRecordsByIds(runtime, knex, ids, callOptions);
    },
    async listByForeignIds(ids = [], foreignKey = "", callOptions = {}) {
      const normalizedForeignKey = normalizeText(foreignKey);
      if (!normalizedForeignKey) {
        throw new TypeError(`${runtime.context || "crudRepository"} listByForeignIds requires foreignKey.`);
      }

      return listRecordsByIds(runtime, knex, ids, {
        ...callOptions,
        valueKey: normalizedForeignKey
      });
    },
    async create(payload = {}, callOptions = {}) {
      return createRecord(runtime, knex, payload, callOptions);
    },
    async updateById(recordId, patch = {}, callOptions = {}) {
      return updateRecordById(runtime, knex, recordId, patch, callOptions);
    },
    async deleteById(recordId, callOptions = {}) {
      return deleteRecordById(runtime, knex, recordId, callOptions);
    }
  });
}

export { createCrudResourceRuntime };
