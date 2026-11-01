import {
  createWithTransaction,
  resolveInsertedRecordId,
  resolveRepoClient,
  toInsertDateTime
} from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCrudListLimit,
  applyCrudListQueryFilters,
  buildWritePayload,
  mapRecordRow,
  resolveColumnName
} from "../repositorySupport.js";
import { hydrateCrudLookupRecords } from "./lookupHydration.js";
import { CRUD_FIELD_STORAGE_COLUMN } from "@jskit-ai/resource-crud-core/shared/crudFieldContract";
import {
  applyCrudRepositoryVirtualProjections,
  applyConfiguredQueryStage,
  applyConfiguredObjectStage,
  buildCrudRepositoryActionContextBase
} from "./operationStages.js";
import {
  encodeOrderedListCursor,
  applyOrderedListCursorFilter,
  enforceCrudRepositoryListControls
} from "./listControls.js";
import {
  normalizeRepositoryInputPayload,
  normalizeRepositoryOutputRecord
} from "./recordValidation.js";
import { buildCompiledCrudRepositoryRuntime } from "./compiledRuntime.js";

/** @typedef {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} RuntimeKnex */

function requireCrudRecordId(value, { context }) {
  const recordId = normalizeRecordId(value, { fallback: null });
  if (!recordId) {
    throw new TypeError(`${context} requires recordId.`);
  }
  return recordId;
}

/**
 * What one repository call reads and writes through: the call's transaction
 * (else the repository's Knex), with the runtime's table and id column, and the
 * visibility filter of the call's visibility context.
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {object} callOptions
 */
function resolveCrudRepositoryCall(runtime, knex, callOptions) {
  return Object.freeze({
    client: resolveRepoClient(knex, callOptions),
    tableName: runtime.tableName,
    idColumn: runtime.idColumn,
    visible: (queryBuilder) => applyVisibility(queryBuilder, callOptions.visibilityContext)
  });
}

function applyCrudRepositoryReadLock(dbQuery, callOptions) {
  if (callOptions.forUpdate === true) {
    return dbQuery.forUpdate();
  }

  return dbQuery;
}

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {object} query
 * @param {object} callOptions
 */
async function listRecords(runtime, knex, query, callOptions) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedLimit = normalizeCrudListLimit(query.limit, {
    fallback: runtime.list.defaultLimit,
    max: runtime.list.maxLimit
  });
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
  const usesOrderedListCursor = runtime.list.orderBy.length > 0;
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);
  dbQuery = applyCrudRepositoryVirtualProjections(dbQuery, runtime, {
    knex: client,
    tableName
  });

  dbQuery = applyCrudListQueryFilters(dbQuery, {
    idColumn,
    cursor: query.cursor,
    applyCursor: usesOrderedListCursor !== true,
    q: query.q,
    searchColumns: runtime.list.searchColumns,
    parentFilters: query,
    parentFilterColumns: runtime.mapping.parentFilterColumns
  });
  if (usesOrderedListCursor) {
    dbQuery = applyOrderedListCursorFilter(dbQuery, {
      orderBy: runtime.list.orderBy,
      cursor: query.cursor
    });
  }

  const readListStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations.read.applyQuery,
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
    runtime.operations.list.applyQuery,
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
      {
        recordIdKeys: runtime.mapping.outputRecordIdKeys,
        serializerByKey: runtime.mapping.outputSerializerByKey
      }
    );
    if (!mappedRecord) {
      continue;
    }

    items.push(await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
      operation: "list"
    }));
  }

  const hydratedItems = await hydrateCrudLookupRecords(items, runtime.lookup, {
    include: callOptions.include,
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

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {unknown} recordId
 * @param {object} callOptions
 */
async function findRecordById(runtime, knex, recordId, callOptions) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.findById" });
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
  let dbQuery = client(tableName)
    .select(...runtime.selectColumns);
  dbQuery = applyCrudRepositoryVirtualProjections(dbQuery, runtime, {
    knex: client,
    tableName
  });

  const readFindStageResult = await applyConfiguredQueryStage(
    dbQuery,
    runtime.operations.read.applyQuery,
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
    runtime.operations.findById.applyQuery,
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
    {
      recordIdKeys: runtime.mapping.outputRecordIdKeys,
      serializerByKey: runtime.mapping.outputSerializerByKey
    }
  );
  if (!mappedRecord) {
    return null;
  }

  const normalizedRecord = await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
    operation: "findById"
  });
  const hydrated = await hydrateCrudLookupRecords([normalizedRecord], runtime.lookup, {
    include: callOptions.include,
    mode: "view",
    repositoryOptions: runtime.repositoryOptions,
    callOptions
  });

  return hydrated[0] || null;
}

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {unknown[]} ids
 * @param {object} callOptions
 */
async function listRecordsByIds(runtime, knex, ids, callOptions) {
  const { client, tableName, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
  const lookupValueKey = normalizeText(callOptions.valueKey) || "id";
  if (!runtime.mapping.outputKeys.includes(lookupValueKey)) {
    throw new TypeError(
      `${runtime.context} listByIds requires valueKey "${lookupValueKey}" to exist in output schema.`
    );
  }
  if (runtime.mapping.fieldStorageByKey[lookupValueKey] !== CRUD_FIELD_STORAGE_COLUMN) {
    throw new TypeError(
      `${runtime.context} listByIds requires valueKey "${lookupValueKey}" to be column-backed.`
    );
  }
  const lookupColumn = resolveColumnName(lookupValueKey, runtime.mapping.columnOverrides);
  if (!lookupColumn) {
    throw new TypeError(`${runtime.context} listByIds requires a valid valueKey.`);
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
    runtime.operations.read.applyQuery,
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
    runtime.operations.listByIds.applyQuery,
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
      {
        recordIdKeys: runtime.mapping.outputRecordIdKeys,
        serializerByKey: runtime.mapping.outputSerializerByKey
      }
    );
    if (!mappedRecord) {
      continue;
    }

    records.push(await normalizeRepositoryOutputRecord(runtime, mappedRecord, {
      operation: "listByIds"
    }));
  }

  const lookupInclude = callOptions.include === undefined ? "none" : callOptions.include;
  return hydrateCrudLookupRecords(records, runtime.lookup, {
    include: lookupInclude,
    mode: "list",
    repositoryOptions: runtime.repositoryOptions,
    callOptions
  });
}

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {object} payload
 * @param {object} callOptions
 */
async function createRecord(runtime, knex, payload, callOptions) {
  const { client, tableName } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
  let sourcePayload = await normalizeRepositoryInputPayload(runtime, payload, "create");
  sourcePayload = await applyConfiguredObjectStage(
    sourcePayload,
    runtime.operations.create.preparePayload,
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
    runtime.operations.create.prepareInsertPayload,
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
    runtime.operations.create.applyQuery,
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

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {unknown} recordId
 * @param {object} patch
 * @param {object} callOptions
 */
async function updateRecordById(runtime, knex, recordId, patch, callOptions) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.updateById" });
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
  let sourcePatch = await normalizeRepositoryInputPayload(runtime, patch, "patch");
  sourcePatch = await applyConfiguredObjectStage(
    sourcePatch,
    runtime.operations.updateById.preparePatch,
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
    runtime.operations.updateById.applyQuery,
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

/**
 * @param {import("../types.js").CompiledCrudRepositoryRuntime} runtime
 * @param {RuntimeKnex} knex
 * @param {unknown} recordId
 * @param {object} callOptions
 */
async function deleteRecordById(runtime, knex, recordId, callOptions) {
  const { client, tableName, idColumn, visible } = resolveCrudRepositoryCall(runtime, knex, callOptions);
  const normalizedRecordId = requireCrudRecordId(recordId, { context: "crudRepository.deleteById" });
  const actionContextBase = buildCrudRepositoryActionContextBase(runtime, callOptions);
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
    runtime.operations.deleteById.applyQuery,
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

/**
 * @param {import("../types.js").CrudResourceDefinition} resource
 * @param {RuntimeKnex} knex
 * @param {object} [repositoryOptions]
 */
function createCrudResourceRuntime(resource, knex, repositoryOptions = {}) {
  // readable-check: allow method-probe - input validation: the application passes its own Knex instance
  if (typeof knex !== "function" || typeof knex.transaction !== "function") {
    throw new TypeError("createCrudResourceRuntime requires the application's Knex instance.");
  }

  const runtime = buildCompiledCrudRepositoryRuntime(resource, repositoryOptions);
  const withTransaction = createWithTransaction(knex);

  async function list(query = {}, callOptions = {}) {
    return listRecords(runtime, knex, query, callOptions);
  }

  async function findById(recordId, callOptions = {}) {
    return findRecordById(runtime, knex, recordId, callOptions);
  }

  async function listByIds(ids = [], callOptions = {}) {
    return listRecordsByIds(runtime, knex, ids, callOptions);
  }

  async function listByForeignIds(ids = [], foreignKey = "", callOptions = {}) {
    const normalizedForeignKey = normalizeText(foreignKey);
    if (!normalizedForeignKey) {
      throw new TypeError(`${runtime.context} listByForeignIds requires foreignKey.`);
    }

    return listRecordsByIds(runtime, knex, ids, {
      ...callOptions,
      valueKey: normalizedForeignKey
    });
  }

  async function create(payload = {}, callOptions = {}) {
    return createRecord(runtime, knex, payload, callOptions);
  }

  async function updateById(recordId, patch = {}, callOptions = {}) {
    return updateRecordById(runtime, knex, recordId, patch, callOptions);
  }

  async function deleteById(recordId, callOptions = {}) {
    return deleteRecordById(runtime, knex, recordId, callOptions);
  }

  return Object.freeze({
    withTransaction,
    list,
    findById,
    listByIds,
    listByForeignIds,
    create,
    updateById,
    deleteById
  });
}

export { createCrudResourceRuntime };
