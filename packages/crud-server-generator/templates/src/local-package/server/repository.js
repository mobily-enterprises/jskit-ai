import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import {
  DEFAULT_LIST_LIMIT,
  buildRepositoryColumnMetadata,
  deriveRepositoryMappingFromResource,
  applyCrudListQueryFilters,
  normalizeCrudListLimit,
  requireCrudTableName,
  buildWritePayload as baseBuildWritePayload,
  mapRecordRow as baseMapRecordRow,
  resolveCrudIdColumn
} from "@jskit-ai/crud-core/server/repositorySupport";
import { ${option:namespace|singular|camel}Resource } from "../shared/${option:namespace|singular|camel}Resource.js";

const DEFAULT_ID_COLUMN = __JSKIT_CRUD_ID_COLUMN__;
const CREATED_AT_COLUMN = __JSKIT_CRUD_REPOSITORY_CREATED_AT_COLUMN__;
const UPDATED_AT_COLUMN = __JSKIT_CRUD_REPOSITORY_UPDATED_AT_COLUMN__;
const {
  outputKeys: OUTPUT_KEYS,
  writeKeys: WRITE_KEYS,
  columnOverrides: COLUMN_OVERRIDES,
  listSearchColumns: LIST_SEARCH_COLUMNS
} = deriveRepositoryMappingFromResource(${option:namespace|singular|camel}Resource, {
  context: "${option:namespace|snake} repository"
});

const { selectColumns: SELECT_COLUMNS } = buildRepositoryColumnMetadata({
  outputKeys: OUTPUT_KEYS,
  writeKeys: WRITE_KEYS,
  columnOverrides: COLUMN_OVERRIDES
});

function createRepository(knex, { tableName, idColumn = DEFAULT_ID_COLUMN } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("crudRepository requires knex.");
  }

  const resolvedTableName = requireCrudTableName(tableName);
  const resolvedIdColumn = resolveCrudIdColumn(idColumn, { fallback: DEFAULT_ID_COLUMN });

  async function list({ cursor = 0, limit = DEFAULT_LIST_LIMIT, q = "" } = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedLimit = normalizeCrudListLimit(limit);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    let query = client(resolvedTableName)
      .select(...SELECT_COLUMNS)
      .where(visible)
      .orderBy(resolvedIdColumn, "asc")
      .limit(normalizedLimit + 1);

    query = applyCrudListQueryFilters(query, {
      idColumn: resolvedIdColumn,
      cursor,
      q,
      searchColumns: LIST_SEARCH_COLUMNS
    });

    const rows = await query;
    const hasMore = rows.length > normalizedLimit;
    const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
    const items = pageRows.map((row) => baseMapRecordRow(row, OUTPUT_KEYS, COLUMN_OVERRIDES));

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1].id) : null
    };
  }

  async function findById(recordId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const row = await client(resolvedTableName)
      .select(...SELECT_COLUMNS)
      .where(visible)
      .where({
        [resolvedIdColumn]: Number(recordId)
      })
      .first();

    return baseMapRecordRow(row, OUTPUT_KEYS, COLUMN_OVERRIDES);
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const timestamp = toInsertDateTime();
    const insertPayload = baseBuildWritePayload(payload, WRITE_KEYS, COLUMN_OVERRIDES);
    if (CREATED_AT_COLUMN && !Object.hasOwn(insertPayload, CREATED_AT_COLUMN)) {
      insertPayload[CREATED_AT_COLUMN] = timestamp;
    }
    if (UPDATED_AT_COLUMN && !Object.hasOwn(insertPayload, UPDATED_AT_COLUMN)) {
      insertPayload[UPDATED_AT_COLUMN] = timestamp;
    }

    const withOwners = applyVisibilityOwners(insertPayload, options.visibilityContext);
    const [recordId] = await client(resolvedTableName).insert(withOwners);

    return findById(recordId, {
      ...options,
      trx: client
    });
  }

  async function updateById(recordId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const dbPatch = baseBuildWritePayload(patch, WRITE_KEYS, COLUMN_OVERRIDES);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    if (UPDATED_AT_COLUMN) {
      dbPatch[UPDATED_AT_COLUMN] = toInsertDateTime();
    }

    if (Object.keys(dbPatch).length < 1) {
      return findById(recordId, {
        ...options,
        trx: client
      });
    }

    await client(resolvedTableName)
      .where(visible)
      .where({
        [resolvedIdColumn]: Number(recordId)
      })
      .update(dbPatch);

    return findById(recordId, {
      ...options,
      trx: client
    });
  }

  async function deleteById(recordId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const existing = await findById(recordId, {
      ...options,
      trx: client
    });

    if (!existing) {
      return null;
    }

    await client(resolvedTableName)
      .where(visible)
      .where({
        [resolvedIdColumn]: Number(recordId)
      })
      .delete();

    return {
      id: existing.id,
      deleted: true
    };
  }

  return Object.freeze({
    list,
    findById,
    create,
    updateById,
    deleteById
  });
}

export { createRepository };
