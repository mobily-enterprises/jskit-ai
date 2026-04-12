import { resolveInsertedRecordId, toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId, normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
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
} from "./repositorySupport.js";
import {
  createCrudLookupRuntime,
  hydrateCrudLookupRecords
} from "./lookupHydration.js";

const LIST_ORDER_DIRECTION_ASC = "asc";
const LIST_ORDER_DIRECTION_DESC = "desc";
const LIST_ORDER_NULLS_FIRST = "first";
const LIST_ORDER_NULLS_LAST = "last";
const ORDERED_LIST_CURSOR_VALUE_TYPE_KEY = "__jskitCursorValueType";
const ORDERED_LIST_CURSOR_VALUE_KEY = "value";
const ORDERED_LIST_CURSOR_VALUE_TYPE_DATE = "date";

function requireCrudRecordId(value, { context = "crudRepository" } = {}) {
  const recordId = normalizeRecordId(value, { fallback: null });
  if (!recordId) {
    throw new TypeError(`${context} requires recordId.`);
  }
  return recordId;
}

function resolveRepositoryDefaults(resource = {}, repositoryMapping = {}) {
  const resourceName = normalizeText(resource.resource);
  const tableName = normalizeText(resource.tableName) || resourceName;
  if (!tableName) {
    throw new TypeError("createCrudRepositoryFromResource requires resource.tableName or resource.resource.");
  }

  const idColumn = normalizeText(resource.idColumn) || resolveColumnName("id", repositoryMapping.columnOverrides) || "id";
  const createdAtColumn = repositoryMapping.outputKeys.includes("createdAt")
    ? resolveColumnName("createdAt", repositoryMapping.columnOverrides)
    : "";
  const updatedAtColumn = repositoryMapping.outputKeys.includes("updatedAt")
    ? resolveColumnName("updatedAt", repositoryMapping.columnOverrides)
    : "";

  return Object.freeze({
    tableName,
    idColumn,
    createdAtColumn,
    updatedAtColumn
  });
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
    const appended = appendOrderedListCursorBranches(cursorQuery, normalizedOrderBy, cursorValues);
    if (!appended) {
      cursorQuery.whereRaw("1 = 0");
    }
  });
}

function resolveRecordOutputValidator(resource = {}, { context = "crudRepository" } = {}) {
  const outputValidator = resource?.operations?.view?.outputValidator;
  if (!outputValidator || typeof outputValidator !== "object" || Array.isArray(outputValidator)) {
    throw new TypeError(`${context} requires resource.operations.view.outputValidator.`);
  }

  const schema = outputValidator?.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${context} requires resource.operations.view.outputValidator.schema.`);
  }

  const normalize = typeof outputValidator.normalize === "function"
    ? outputValidator.normalize
    : (payload = {}) => payload;

  return Object.freeze({
    schema,
    normalize
  });
}

function formatOutputValidationError(error = {}) {
  const path = normalizeText(error?.instancePath || error?.path) || "/";
  const message = normalizeText(error?.message) || "invalid output value";
  return `${path} ${message}`;
}

async function normalizeRepositoryOutputRecord(runtime, record = {}, { operation = "read" } = {}) {
  const outputRuntime = runtime?.output || {};
  const normalizedRecord = await outputRuntime.normalize(record);
  if (Check(outputRuntime.schema, normalizedRecord)) {
    return normalizedRecord;
  }

  const issues = [...Errors(outputRuntime.schema, normalizedRecord)];
  const formattedIssue = formatOutputValidationError(issues[0]);
  throw new TypeError(
    `${runtime?.context || "crudRepository"} ${operation} output validation failed: ${formattedIssue}.`
  );
}

function createCrudRepositoryRuntime(resource = {}, { context = "crudRepository", list = {} } = {}) {
  const repositoryMapping = deriveRepositoryMappingFromResource(resource, { context });
  const defaults = resolveRepositoryDefaults(resource, repositoryMapping);
  const output = resolveRecordOutputValidator(resource, { context });
  const lookupRuntime = createCrudLookupRuntime(resource, {
    outputKeys: repositoryMapping.outputKeys
  });
  const listRuntime = resolveListRuntimeConfig(list, repositoryMapping.listSearchColumns, {
    idColumn: defaults.idColumn
  });
  const { selectColumns } = buildRepositoryColumnMetadata({
    outputKeys: repositoryMapping.outputKeys,
    writeKeys: repositoryMapping.writeKeys,
    columnOverrides: repositoryMapping.columnOverrides
  });
  const normalizedSelectColumns = Object.freeze(
    [...new Set([
      ...selectColumns,
      ...listRuntime.orderBy.map(({ column }) => column)
    ])]
  );

  return Object.freeze({
    context,
    defaults,
    selectColumns: normalizedSelectColumns,
    output,
    list: listRuntime,
    lookup: lookupRuntime,
    mapping: repositoryMapping
  });
}

function resolveCrudRepositoryCall(runtime, knex, repositoryOptions = {}, callOptions = {}) {
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    throw new TypeError("crudRepository methods require runtime.");
  }
  if (typeof knex !== "function") {
    throw new TypeError("crudRepository requires knex.");
  }

  const client = callOptions?.trx || knex;
  const tableName = requireCrudTableName(repositoryOptions?.tableName ?? runtime.defaults?.tableName, {
    context: runtime.context || "crudRepository"
  });
  const idColumn = resolveCrudIdColumn(repositoryOptions?.idColumn, {
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

function normalizeCrudRepositoryHooks(hooks = null, allowedHookKeys = [], { context = "crudRepository" } = {}) {
  if (hooks === null || hooks === undefined) {
    return Object.freeze({});
  }
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new TypeError(`${context} hooks must be an object when provided.`);
  }

  const supportedHookKeys = (Array.isArray(allowedHookKeys) ? allowedHookKeys : [])
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  const supportedHookKeySet = new Set(supportedHookKeys);
  const normalizedHooks = {};

  for (const [rawHookKey, rawHook] of Object.entries(hooks)) {
    const normalizedHookKey = normalizeText(rawHookKey);
    if (!normalizedHookKey) {
      continue;
    }
    if (!supportedHookKeySet.has(normalizedHookKey)) {
      throw new TypeError(
        `${context} does not support hooks.${normalizedHookKey}. Allowed hooks: ${supportedHookKeys.join(", ")}.`
      );
    }

    if (rawHook === null || rawHook === undefined) {
      continue;
    }
    if (typeof rawHook !== "function") {
      throw new TypeError(`${context} hooks.${normalizedHookKey} must be a function.`);
    }

    normalizedHooks[normalizedHookKey] = rawHook;
  }

  return Object.freeze(normalizedHooks);
}

function resolveOptionalCrudRepositoryHook(
  hooks = {},
  hookKey = "",
  { context = "crudRepository" } = {}
) {
  const normalizedHookKey = normalizeText(hookKey);
  if (!normalizedHookKey) {
    return null;
  }

  const directHook = hooks?.[normalizedHookKey];
  if (directHook !== undefined && directHook !== null) {
    if (typeof directHook !== "function") {
      throw new TypeError(`${context} hooks.${normalizedHookKey} must be a function.`);
    }
    return directHook;
  }
  return null;
}

async function applyCrudRepositoryQueryHook(
  dbQuery,
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "modifyQuery" } = {}
) {
  if (typeof hook !== "function") {
    return {
      queryBuilder: dbQuery
    };
  }

  const directResult = hook(dbQuery, hookContext);
  if (directResult === undefined || directResult === dbQuery) {
    return {
      queryBuilder: dbQuery
    };
  }

  if (directResult && typeof directResult.then === "function") {
    const awaitedResult = await directResult;
    if (awaitedResult === undefined || awaitedResult === dbQuery) {
      return {
        queryBuilder: dbQuery
      };
    }
  }

  throw new TypeError(
    `${context} hooks.${hookKey} must mutate the provided query builder and return undefined or the same builder.`
  );
}

function normalizeCrudRepositoryObjectInput(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

async function applyCrudRepositoryPayloadHook(
  payload = {},
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "modifyPayload" } = {}
) {
  const normalizedPayload = normalizeCrudRepositoryObjectInput(payload);
  if (typeof hook !== "function") {
    return normalizedPayload;
  }

  const nextPayload = await hook(normalizedPayload, hookContext);
  if (nextPayload === undefined) {
    return normalizedPayload;
  }

  if (!nextPayload || typeof nextPayload !== "object" || Array.isArray(nextPayload)) {
    throw new TypeError(`${context} hooks.${hookKey} must return an object when it returns a value.`);
  }

  return nextPayload;
}

async function applyCrudRepositoryRecordsHook(
  items = [],
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "afterQuery" } = {}
) {
  const normalizedItems = Array.isArray(items) ? items : [];
  if (typeof hook !== "function") {
    return normalizedItems;
  }

  const nextItems = await hook(normalizedItems, hookContext);
  if (nextItems === undefined) {
    return normalizedItems;
  }
  if (!Array.isArray(nextItems)) {
    throw new TypeError(`${context} hooks.${hookKey} must return an array when it returns a value.`);
  }

  return nextItems;
}

async function applyCrudRepositoryRecordHook(
  record = null,
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "transformReturnedRecord" } = {}
) {
  if (record === null || record === undefined) {
    return null;
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError(`${context} ${hookKey} record must be an object.`);
  }
  if (typeof hook !== "function") {
    return record;
  }

  const nextRecord = await hook(record, hookContext);
  if (nextRecord === undefined) {
    return record;
  }
  if (!nextRecord || typeof nextRecord !== "object" || Array.isArray(nextRecord)) {
    throw new TypeError(`${context} hooks.${hookKey} must return an object when it returns a value.`);
  }

  return nextRecord;
}

async function applyCrudRepositoryOutputHook(
  output,
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "finalizeOutput", validateOutput = null } = {}
) {
  if (typeof hook !== "function") {
    if (typeof validateOutput === "function") {
      validateOutput(output);
    }
    return output;
  }

  const nextOutput = await hook(output, hookContext);
  const resolvedOutput = nextOutput === undefined ? output : nextOutput;
  if (typeof validateOutput === "function") {
    validateOutput(resolvedOutput);
  }

  return resolvedOutput;
}

async function applyCrudRepositoryAfterWriteHook(
  meta = {},
  hook = null,
  hookContext = {},
  { context = "crudRepository", hookKey = "afterWrite" } = {}
) {
  if (typeof hook !== "function") {
    return;
  }

  await hook(meta, hookContext);
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

function createCrudRepositoryHookContextBase(runtime, repositoryOptions = {}, callOptions = {}) {
  return {
    runtime,
    repositoryOptions,
    callOptions,
    state: {}
  };
}

async function crudRepositoryList(runtime, knex, query = {}, repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const methodHooks = normalizeCrudRepositoryHooks(
    hooks,
    ["modifyQuery", "afterQuery", "transformReturnedRecord", "finalizeOutput"],
    {
      context: "crudRepositoryList"
    }
  );
  const modifyListQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryList"
  });
  const afterListQuery = resolveOptionalCrudRepositoryHook(methodHooks, "afterQuery", {
    context: "crudRepositoryList"
  });
  const transformListRecord = resolveOptionalCrudRepositoryHook(methodHooks, "transformReturnedRecord", {
    context: "crudRepositoryList"
  });
  const finalizeListOutput = resolveOptionalCrudRepositoryHook(methodHooks, "finalizeOutput", {
    context: "crudRepositoryList"
  });
  const normalizedLimit = normalizeCrudListLimit(query?.limit, {
    fallback: runtime.list.defaultLimit,
    max: runtime.list.maxLimit
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  const usesOrderedListCursor = runtime.list.orderBy.length > 0;
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);

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

  const listHookResult = await applyCrudRepositoryQueryHook(
    dbQuery,
    modifyListQuery,
    {
      query,
      ...hookContextBase
    },
    {
      context: "crudRepositoryList",
      hookKey: "modifyQuery"
    }
  );
  dbQuery = listHookResult.queryBuilder;

  dbQuery = dbQuery.where(visible);
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

  let hydratedItems = await hydrateCrudLookupRecords(items, {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: query?.include,
    mode: "list",
    repositoryOptions,
    callOptions
  });

  hydratedItems = await applyCrudRepositoryRecordsHook(
    hydratedItems,
    afterListQuery,
    {
      query,
      ...hookContextBase
    },
    {
      context: "crudRepositoryList",
      hookKey: "afterQuery"
    }
  );

  const transformedItems = [];
  for (let itemIndex = 0; itemIndex < hydratedItems.length; itemIndex += 1) {
    transformedItems.push(
      await applyCrudRepositoryRecordHook(
        hydratedItems[itemIndex],
        transformListRecord,
        {
          query,
          itemIndex,
          items: hydratedItems,
          ...hookContextBase
        },
        {
          context: "crudRepositoryList",
          hookKey: "transformReturnedRecord"
        }
      )
    );
  }

  const lastPageRow = pageRows[pageRows.length - 1] || null;
  const nextCursor = hasMore && lastPageRow
    ? (
        usesOrderedListCursor
          ? encodeOrderedListCursor(lastPageRow, runtime.list.orderBy)
          : String(lastPageRow[idColumn])
      )
    : null;
  let output = {
    items: transformedItems,
    nextCursor
  };

  output = await applyCrudRepositoryOutputHook(
    output,
    finalizeListOutput,
    {
      query,
      ...hookContextBase
    },
    {
      context: "crudRepositoryList",
      hookKey: "finalizeOutput",
      validateOutput(nextOutput) {
        if (!nextOutput || typeof nextOutput !== "object" || Array.isArray(nextOutput)) {
          throw new TypeError("crudRepositoryList hooks.finalizeOutput must return an object.");
        }
        if (!Object.hasOwn(nextOutput, "items")) {
          throw new TypeError('crudRepositoryList hooks.finalizeOutput must return required key "items".');
        }
        if (!Object.hasOwn(nextOutput, "nextCursor")) {
          throw new TypeError('crudRepositoryList hooks.finalizeOutput must return required key "nextCursor".');
        }
        if (!Array.isArray(nextOutput.items)) {
          throw new TypeError('crudRepositoryList hooks.finalizeOutput must return "items" as an array.');
        }
      }
    }
  );

  return output;
}

async function crudRepositoryFindById(runtime, knex, recordId, repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepositoryFindById" });
  const methodHooks = normalizeCrudRepositoryHooks(
    hooks,
    ["modifyQuery", "afterQuery", "transformReturnedRecord", "finalizeOutput"],
    {
      context: "crudRepositoryFindById"
    }
  );
  const modifyFindByIdQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryFindById"
  });
  const afterFindByIdQuery = resolveOptionalCrudRepositoryHook(methodHooks, "afterQuery", {
    context: "crudRepositoryFindById"
  });
  const transformFindByIdRecord = resolveOptionalCrudRepositoryHook(methodHooks, "transformReturnedRecord", {
    context: "crudRepositoryFindById"
  });
  const finalizeFindByIdOutput = resolveOptionalCrudRepositoryHook(methodHooks, "finalizeOutput", {
    context: "crudRepositoryFindById"
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);

  const findByIdHookResult = await applyCrudRepositoryQueryHook(
    dbQuery,
    modifyFindByIdQuery,
    {
      recordId,
      ...hookContextBase
    },
    {
      context: "crudRepositoryFindById",
      hookKey: "modifyQuery"
    }
  );
  dbQuery = findByIdHookResult.queryBuilder;

  dbQuery = dbQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });

  const row = await dbQuery.first();

  const mappedRecord = mapRecordRow(
    row,
    runtime.mapping.outputKeys,
    runtime.mapping.columnOverrides,
    { recordIdKeys: runtime.mapping.outputRecordIdKeys }
  );
  let records = [];
  if (mappedRecord) {
    const normalizedRecord = await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
      operation: "findById"
    });
    const hydrated = await hydrateCrudLookupRecords([normalizedRecord], {
      ...runtime.lookup,
      context: runtime.context
    }, {
      include: callOptions?.include,
      mode: "view",
      repositoryOptions,
      callOptions
    });
    records = hydrated[0] ? [hydrated[0]] : [];
  }

  records = await applyCrudRepositoryRecordsHook(
    records,
    afterFindByIdQuery,
    {
      recordId,
      ...hookContextBase
    },
    {
      context: "crudRepositoryFindById",
      hookKey: "afterQuery"
    }
  );

  let output = records[0] || null;
  output = await applyCrudRepositoryRecordHook(
    output,
    transformFindByIdRecord,
    {
      recordId,
      ...hookContextBase
    },
    {
      context: "crudRepositoryFindById",
      hookKey: "transformReturnedRecord"
    }
  );

  return applyCrudRepositoryOutputHook(
    output,
    finalizeFindByIdOutput,
    {
      recordId,
      ...hookContextBase
    },
    {
      context: "crudRepositoryFindById",
      hookKey: "finalizeOutput",
      validateOutput(nextOutput) {
        if (nextOutput === null) {
          return;
        }
        if (!nextOutput || typeof nextOutput !== "object" || Array.isArray(nextOutput)) {
          throw new TypeError("crudRepositoryFindById hooks.finalizeOutput must return record object or null.");
        }
      }
    }
  );
}

async function crudRepositoryListByIds(runtime, knex, ids = [], repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const methodHooks = normalizeCrudRepositoryHooks(
    hooks,
    ["modifyQuery", "afterQuery", "transformReturnedRecord", "finalizeOutput"],
    {
      context: "crudRepositoryListByIds"
    }
  );
  const modifyListByIdsQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryListByIds"
  });
  const afterListByIdsQuery = resolveOptionalCrudRepositoryHook(methodHooks, "afterQuery", {
    context: "crudRepositoryListByIds"
  });
  const transformListByIdsRecord = resolveOptionalCrudRepositoryHook(methodHooks, "transformReturnedRecord", {
    context: "crudRepositoryListByIds"
  });
  const finalizeListByIdsOutput = resolveOptionalCrudRepositoryHook(methodHooks, "finalizeOutput", {
    context: "crudRepositoryListByIds"
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  const lookupValueKey = normalizeText(callOptions?.valueKey) || "id";
  if (!runtime.mapping.outputKeys.includes(lookupValueKey)) {
    throw new TypeError(
      `${runtime.context || "crudRepository"} listByIds requires valueKey "${lookupValueKey}" to exist in output schema.`
    );
  }
  const lookupColumn = resolveColumnName(lookupValueKey, runtime.mapping.columnOverrides);
  if (!lookupColumn) {
    throw new TypeError(`${runtime.context || "crudRepository"} listByIds requires a valid valueKey.`);
  }

  const normalizedIds = normalizeUniqueTextList(ids);
  if (normalizedIds.length < 1) {
    return [];
  }

  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);

  const listByIdsHookResult = await applyCrudRepositoryQueryHook(
    dbQuery,
    modifyListByIdsQuery,
    {
      ids: normalizedIds,
      lookupValueKey,
      lookupColumn,
      ...hookContextBase
    },
    {
      context: "crudRepositoryListByIds",
      hookKey: "modifyQuery"
    }
  );
  dbQuery = listByIdsHookResult.queryBuilder;

  dbQuery = dbQuery
    .where(visible)
    .whereIn(lookupColumn, normalizedIds);

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
  let hydratedRecords = await hydrateCrudLookupRecords(records, {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: lookupInclude,
    mode: "list",
    repositoryOptions,
    callOptions
  });

  hydratedRecords = await applyCrudRepositoryRecordsHook(
    hydratedRecords,
    afterListByIdsQuery,
    {
      ids: normalizedIds,
      ...hookContextBase
    },
    {
      context: "crudRepositoryListByIds",
      hookKey: "afterQuery"
    }
  );

  const transformedRecords = [];
  for (let itemIndex = 0; itemIndex < hydratedRecords.length; itemIndex += 1) {
    transformedRecords.push(
      await applyCrudRepositoryRecordHook(
        hydratedRecords[itemIndex],
        transformListByIdsRecord,
        {
          ids: normalizedIds,
          itemIndex,
          items: hydratedRecords,
          ...hookContextBase
        },
        {
          context: "crudRepositoryListByIds",
          hookKey: "transformReturnedRecord"
        }
      )
    );
  }

  return applyCrudRepositoryOutputHook(
    transformedRecords,
    finalizeListByIdsOutput,
    {
      ids: normalizedIds,
      ...hookContextBase
    },
    {
      context: "crudRepositoryListByIds",
      hookKey: "finalizeOutput",
      validateOutput(nextOutput) {
        if (!Array.isArray(nextOutput)) {
          throw new TypeError("crudRepositoryListByIds hooks.finalizeOutput must return an array.");
        }
      }
    }
  );
}

async function crudRepositoryListByForeignIds(
  runtime,
  knex,
  ids = [],
  foreignKey = "",
  repositoryOptions = {},
  callOptions = {},
  hooks = null
) {
  const normalizedForeignKey = normalizeText(foreignKey);
  if (!normalizedForeignKey) {
    throw new TypeError(`${runtime?.context || "crudRepository"} listByForeignIds requires foreignKey.`);
  }

  return crudRepositoryListByIds(
    runtime,
    knex,
    ids,
    repositoryOptions,
    {
      ...callOptions,
      valueKey: normalizedForeignKey
    },
    hooks
  );
}

async function crudRepositoryCreate(runtime, knex, payload = {}, repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const methodHooks = normalizeCrudRepositoryHooks(hooks, ["modifyPayload", "finalizeInsertPayload", "modifyQuery", "afterWrite"], {
    context: "crudRepositoryCreate"
  });
  const modifyCreatePayload = resolveOptionalCrudRepositoryHook(methodHooks, "modifyPayload", {
    context: "crudRepositoryCreate"
  });
  const finalizeCreateInsertPayload = resolveOptionalCrudRepositoryHook(methodHooks, "finalizeInsertPayload", {
    context: "crudRepositoryCreate"
  });
  const modifyCreateQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryCreate"
  });
  const afterCreateWrite = resolveOptionalCrudRepositoryHook(methodHooks, "afterWrite", {
    context: "crudRepositoryCreate"
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  let sourcePayload = normalizeCrudRepositoryObjectInput(payload);
  sourcePayload = await applyCrudRepositoryPayloadHook(
    sourcePayload,
    modifyCreatePayload,
    {
      payload: sourcePayload,
      ...hookContextBase
    },
    {
      context: "crudRepositoryCreate",
      hookKey: "modifyPayload"
    }
  );

  let insertPayload = buildWritePayload(sourcePayload, runtime.mapping.writeKeys, runtime.mapping.columnOverrides);
  const timestamp = toInsertDateTime();
  if (runtime.defaults.createdAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.createdAtColumn)) {
    insertPayload[runtime.defaults.createdAtColumn] = timestamp;
  }
  if (runtime.defaults.updatedAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.updatedAtColumn)) {
    insertPayload[runtime.defaults.updatedAtColumn] = timestamp;
  }
  insertPayload = await applyCrudRepositoryPayloadHook(
    insertPayload,
    finalizeCreateInsertPayload,
    {
      payload: sourcePayload,
      insertPayload: {
        ...insertPayload
      },
      ...hookContextBase
    },
    {
      context: "crudRepositoryCreate",
      hookKey: "finalizeInsertPayload"
    }
  );

  let withOwners = applyVisibilityOwners(insertPayload, callOptions.visibilityContext);
  let createQuery = client(tableName);
  const createHookResult = await applyCrudRepositoryQueryHook(
    createQuery,
    modifyCreateQuery,
    {
      payload: {
        ...withOwners
      },
      ...hookContextBase
    },
    {
      context: "crudRepositoryCreate",
      hookKey: "modifyQuery"
    }
  );
  createQuery = createHookResult.queryBuilder;

  const insertResult = await createQuery.insert(withOwners);
  const recordId = resolveInsertedRecordId(insertResult, { fallback: null });
  if (!recordId) {
    throw new Error("crudRepositoryCreate could not resolve inserted id.");
  }

  const createdRecord = await crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    trx: client,
    sourceOperation: "create"
  }, null);

  await applyCrudRepositoryAfterWriteHook(
    {
      operation: "create",
      recordId,
      payload: {
        ...withOwners
      },
      record: createdRecord,
      output: createdRecord
    },
    afterCreateWrite,
    hookContextBase,
    {
      context: "crudRepositoryCreate",
      hookKey: "afterWrite"
    }
  );

  return createdRecord;
}

async function crudRepositoryUpdateById(runtime, knex, recordId, patch = {}, repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepositoryUpdateById" });
  const methodHooks = normalizeCrudRepositoryHooks(hooks, ["modifyPatch", "modifyQuery", "afterWrite"], {
    context: "crudRepositoryUpdateById"
  });
  const modifyUpdatePatch = resolveOptionalCrudRepositoryHook(methodHooks, "modifyPatch", {
    context: "crudRepositoryUpdateById"
  });
  const modifyUpdateByIdQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryUpdateById"
  });
  const afterUpdateWrite = resolveOptionalCrudRepositoryHook(methodHooks, "afterWrite", {
    context: "crudRepositoryUpdateById"
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  let sourcePatch = normalizeCrudRepositoryObjectInput(patch);
  sourcePatch = await applyCrudRepositoryPayloadHook(
    sourcePatch,
    modifyUpdatePatch,
    {
      recordId,
      patch: sourcePatch,
      ...hookContextBase
    },
    {
      context: "crudRepositoryUpdateById",
      hookKey: "modifyPatch"
    }
  );
  let dbPatch = buildWritePayload(sourcePatch, runtime.mapping.writeKeys, runtime.mapping.columnOverrides);

  if (runtime.defaults.updatedAtColumn) {
    dbPatch[runtime.defaults.updatedAtColumn] = toInsertDateTime();
  }

  if (Object.keys(dbPatch).length < 1) {
    return crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
      ...callOptions,
      trx: client,
      sourceOperation: "update"
    }, null);
  }

  let updateQuery = client(tableName);
  const updateHookResult = await applyCrudRepositoryQueryHook(
    updateQuery,
    modifyUpdateByIdQuery,
    {
      recordId,
      patch: {
        ...dbPatch
      },
      ...hookContextBase
    },
    {
      context: "crudRepositoryUpdateById",
      hookKey: "modifyQuery"
    }
  );
  updateQuery = updateHookResult.queryBuilder;

  updateQuery = updateQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });

  await updateQuery.update(dbPatch);

  const updatedRecord = await crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    trx: client,
    sourceOperation: "update"
  }, null);

  await applyCrudRepositoryAfterWriteHook(
    {
      operation: "update",
      recordId,
      patch: {
        ...dbPatch
      },
      record: updatedRecord,
      output: updatedRecord
    },
    afterUpdateWrite,
    hookContextBase,
    {
      context: "crudRepositoryUpdateById",
      hookKey: "afterWrite"
    }
  );

  return updatedRecord;
}

async function crudRepositoryDeleteById(runtime, knex, recordId, repositoryOptions = {}, callOptions = {}, hooks = null) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepositoryDeleteById" });
  const methodHooks = normalizeCrudRepositoryHooks(hooks, ["modifyQuery", "finalizeOutput", "afterWrite"], {
    context: "crudRepositoryDeleteById"
  });
  const modifyDeleteByIdQuery = resolveOptionalCrudRepositoryHook(methodHooks, "modifyQuery", {
    context: "crudRepositoryDeleteById"
  });
  const finalizeDeleteOutput = resolveOptionalCrudRepositoryHook(methodHooks, "finalizeOutput", {
    context: "crudRepositoryDeleteById"
  });
  const afterDeleteWrite = resolveOptionalCrudRepositoryHook(methodHooks, "afterWrite", {
    context: "crudRepositoryDeleteById"
  });
  const hookContextBase = createCrudRepositoryHookContextBase(runtime, repositoryOptions, callOptions);
  const existing = await crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    include: "none",
    trx: client
  }, null);

  if (!existing) {
    return applyCrudRepositoryOutputHook(
      null,
      finalizeDeleteOutput,
      {
        recordId,
        ...hookContextBase
      },
      {
        context: "crudRepositoryDeleteById",
        hookKey: "finalizeOutput",
        validateOutput(nextOutput) {
          if (nextOutput === null) {
            return;
          }
          if (!nextOutput || typeof nextOutput !== "object" || Array.isArray(nextOutput)) {
            throw new TypeError("crudRepositoryDeleteById hooks.finalizeOutput must return object or null.");
          }
        }
      }
    );
  }

  let deleteQuery = client(tableName);
  const deleteHookResult = await applyCrudRepositoryQueryHook(
    deleteQuery,
    modifyDeleteByIdQuery,
    {
      recordId,
      existing,
      ...hookContextBase
    },
    {
      context: "crudRepositoryDeleteById",
      hookKey: "modifyQuery"
    }
  );
  deleteQuery = deleteHookResult.queryBuilder;

  deleteQuery = deleteQuery
    .where(visible)
    .where({
      [idColumn]: normalizedRecordId
    });

  await deleteQuery.delete();

  let output = {
    id: existing.id,
    deleted: true
  };

  output = await applyCrudRepositoryOutputHook(
    output,
    finalizeDeleteOutput,
    {
      recordId,
      ...hookContextBase
    },
    {
      context: "crudRepositoryDeleteById",
      hookKey: "finalizeOutput",
      validateOutput(nextOutput) {
        if (nextOutput === null) {
          return;
        }
        if (!nextOutput || typeof nextOutput !== "object" || Array.isArray(nextOutput)) {
          throw new TypeError("crudRepositoryDeleteById hooks.finalizeOutput must return object or null.");
        }
      }
    }
  );

  await applyCrudRepositoryAfterWriteHook(
    {
      operation: "delete",
      recordId,
      existing,
      output
    },
    afterDeleteWrite,
    hookContextBase,
    {
      context: "crudRepositoryDeleteById",
      hookKey: "afterWrite"
    }
  );

  return output;
}

export {
  createCrudRepositoryRuntime,
  crudRepositoryList,
  crudRepositoryFindById,
  crudRepositoryListByIds,
  crudRepositoryListByForeignIds,
  crudRepositoryCreate,
  crudRepositoryUpdateById,
  crudRepositoryDeleteById
};
