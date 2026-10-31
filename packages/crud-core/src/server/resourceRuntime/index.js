import {
  createWithTransaction,
  resolveInsertedRecordId,
  toInsertDateTime
} from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  normalizeCrudListLimit,
  requireCrudTableName,
  applyCrudListQueryFilters,
  buildWritePayload,
  mapRecordRow,
  resolveColumnName,
  resolveCrudIdColumn
} from "../repositorySupport.js";
import { hydrateCrudLookupRecords } from "./lookupHydration.js";
import { CRUD_FIELD_STORAGE_COLUMN } from "@jskit-ai/resource-crud-core/shared/crudFieldContract";
import {
  applyCrudRepositoryVirtualProjections,
  applyConfiguredQueryStage,
  applyConfiguredObjectStage,
  createCrudRepositoryActionContextBase
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
import { createCompiledCrudRepositoryRuntime } from "./compiledRuntime.js";

function requireCrudRecordId(value, { context = "crudRepository" } = {}) {
  const recordId = normalizeRecordId(value, { fallback: null });
  if (!recordId) {
    throw new TypeError(`${context} requires recordId.`);
  }
  return recordId;
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
  if (callOptions?.forUpdate === true) {
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
  if (runtime.mapping.fieldStorageByKey?.[lookupValueKey] !== CRUD_FIELD_STORAGE_COLUMN) {
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

/**
 * @param {object} resource
 * @param {import("@jskit-ai/database-runtime/server/types").RuntimeKnex} knex
 * @param {object} [repositoryOptions]
 */
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
