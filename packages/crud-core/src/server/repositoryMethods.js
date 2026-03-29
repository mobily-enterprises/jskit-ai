import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
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

function resolveListRuntimeConfig(list = {}, fallbackSearchColumns = []) {
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
    searchColumns: normalizeSearchColumns(list?.searchColumns, fallbackSearchColumns)
  });
}

function createCrudRepositoryRuntime(resource = {}, { context = "crudRepository", list = {} } = {}) {
  const repositoryMapping = deriveRepositoryMappingFromResource(resource, { context });
  const defaults = resolveRepositoryDefaults(resource, repositoryMapping);
  const lookupRuntime = createCrudLookupRuntime(resource, {
    outputKeys: repositoryMapping.outputKeys
  });
  const { selectColumns } = buildRepositoryColumnMetadata({
    outputKeys: repositoryMapping.outputKeys,
    writeKeys: repositoryMapping.writeKeys,
    columnOverrides: repositoryMapping.columnOverrides
  });

  return Object.freeze({
    context,
    defaults,
    selectColumns,
    list: resolveListRuntimeConfig(list, repositoryMapping.listSearchColumns),
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

async function crudRepositoryList(runtime, knex, query = {}, repositoryOptions = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const normalizedLimit = normalizeCrudListLimit(query?.limit, {
    fallback: runtime.list.defaultLimit,
    max: runtime.list.maxLimit
  });
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns)
    .where(visible)
    .orderBy(idColumn, "asc")
    .limit(normalizedLimit + 1);

  dbQuery = applyCrudListQueryFilters(dbQuery, {
    idColumn,
    cursor: query?.cursor,
    q: query?.q,
    searchColumns: runtime.list.searchColumns
  });

  const rows = await dbQuery;
  const hasMore = rows.length > normalizedLimit;
  const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
  const items = pageRows.map((row) => mapRecordRow(row, runtime.mapping.outputKeys, runtime.mapping.columnOverrides));

  const hydratedItems = await hydrateCrudLookupRecords(items, {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: query?.include,
    mode: "list",
    repositoryOptions,
    callOptions
  });

  return {
    items: hydratedItems,
    nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1].id) : null
  };
}

async function crudRepositoryFindById(runtime, knex, recordId, repositoryOptions = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const row = await client(tableName)
    .select(...runtime.selectColumns)
    .where(visible)
    .where({
      [idColumn]: Number(recordId)
    })
    .first();

  const mappedRecord = mapRecordRow(row, runtime.mapping.outputKeys, runtime.mapping.columnOverrides);
  if (!mappedRecord) {
    return null;
  }

  const hydrated = await hydrateCrudLookupRecords([mappedRecord], {
    ...runtime.lookup,
    context: runtime.context
  }, {
    include: callOptions?.include,
    mode: "view",
    repositoryOptions,
    callOptions
  });

  return hydrated[0] || null;
}

async function crudRepositoryListByIds(runtime, knex, ids = [], repositoryOptions = {}, callOptions = {}) {
  const { client, tableName, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
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

  const rows = await client(tableName)
    .select(...runtime.selectColumns)
    .where(visible)
    .whereIn(lookupColumn, normalizedIds);

  return rows.map((row) => mapRecordRow(row, runtime.mapping.outputKeys, runtime.mapping.columnOverrides));
}

async function crudRepositoryCreate(runtime, knex, payload = {}, repositoryOptions = {}, callOptions = {}) {
  const { client, tableName } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const insertPayload = buildWritePayload(payload, runtime.mapping.writeKeys, runtime.mapping.columnOverrides);
  const timestamp = toInsertDateTime();
  if (runtime.defaults.createdAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.createdAtColumn)) {
    insertPayload[runtime.defaults.createdAtColumn] = timestamp;
  }
  if (runtime.defaults.updatedAtColumn && !Object.hasOwn(insertPayload, runtime.defaults.updatedAtColumn)) {
    insertPayload[runtime.defaults.updatedAtColumn] = timestamp;
  }

  const withOwners = applyVisibilityOwners(insertPayload, callOptions.visibilityContext);
  const [recordId] = await client(tableName).insert(withOwners);

  return crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    trx: client
  });
}

async function crudRepositoryUpdateById(runtime, knex, recordId, patch = {}, repositoryOptions = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const dbPatch = buildWritePayload(patch, runtime.mapping.writeKeys, runtime.mapping.columnOverrides);

  if (runtime.defaults.updatedAtColumn) {
    dbPatch[runtime.defaults.updatedAtColumn] = toInsertDateTime();
  }

  if (Object.keys(dbPatch).length < 1) {
    return crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
      ...callOptions,
      trx: client
    });
  }

  await client(tableName)
    .where(visible)
    .where({
      [idColumn]: Number(recordId)
    })
    .update(dbPatch);

  return crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    trx: client
  });
}

async function crudRepositoryDeleteById(runtime, knex, recordId, repositoryOptions = {}, callOptions = {}) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, repositoryOptions, callOptions);
  const existing = await crudRepositoryFindById(runtime, knex, recordId, repositoryOptions, {
    ...callOptions,
    include: "none",
    trx: client
  });

  if (!existing) {
    return null;
  }

  await client(tableName)
    .where(visible)
    .where({
      [idColumn]: Number(recordId)
    })
    .delete();

  return {
    id: existing.id,
    deleted: true
  };
}

export {
  createCrudRepositoryRuntime,
  crudRepositoryList,
  crudRepositoryFindById,
  crudRepositoryListByIds,
  crudRepositoryCreate,
  crudRepositoryUpdateById,
  crudRepositoryDeleteById
};
