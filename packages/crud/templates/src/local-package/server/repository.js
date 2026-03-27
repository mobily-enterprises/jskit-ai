import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName
} from "@jskit-ai/crud-core/server/repositorySupport";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";

const DEFAULT_ID_COLUMN = __JSKIT_CRUD_ID_COLUMN__;
const SELECT_COLUMNS = Object.freeze(__JSKIT_CRUD_REPOSITORY_SELECT_COLUMNS__);
const OUTPUT_MAPPINGS = Object.freeze(__JSKIT_CRUD_REPOSITORY_OUTPUT_MAPPINGS__);
const WRITE_MAPPINGS = Object.freeze(__JSKIT_CRUD_REPOSITORY_WRITE_MAPPINGS__);
const CREATED_AT_COLUMN = __JSKIT_CRUD_REPOSITORY_CREATED_AT_COLUMN__;
const UPDATED_AT_COLUMN = __JSKIT_CRUD_REPOSITORY_UPDATED_AT_COLUMN__;

function mapRecordRow(row) {
  if (!row) {
    return null;
  }

  const mapped = {};
  for (const mapping of OUTPUT_MAPPINGS) {
    const key = String(mapping?.key || "").trim();
    const column = String(mapping?.column || "").trim();
    if (!key || !column) {
      continue;
    }
    mapped[key] = row[column];
  }
  return mapped;
}

function buildWritePayload(sourcePayload = {}) {
  const source = normalizeObjectInput(sourcePayload);
  const payload = {};
  for (const mapping of WRITE_MAPPINGS) {
    const key = String(mapping?.key || "").trim();
    const column = String(mapping?.column || "").trim();
    if (!key || !column) {
      continue;
    }
    if (!Object.hasOwn(source, key)) {
      continue;
    }
    payload[column] = source[key];
  }
  return payload;
}

function resolveIdColumn(idColumn = DEFAULT_ID_COLUMN) {
  const normalized = String(idColumn || "").trim();
  if (!normalized) {
    throw new TypeError("crudRepository requires idColumn.");
  }
  return normalized;
}

function createRepository(knex, { tableName, idColumn = DEFAULT_ID_COLUMN } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("crudRepository requires knex.");
  }

  const resolvedTableName = requireCrudTableName(tableName);
  const resolvedIdColumn = resolveIdColumn(idColumn);

  async function list({ cursor = 0, limit = DEFAULT_LIST_LIMIT } = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedCursor = Number.isInteger(Number(cursor)) && Number(cursor) > 0 ? Number(cursor) : 0;
    const normalizedLimit = normalizeCrudListLimit(limit);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    let query = client(resolvedTableName)
      .select(...SELECT_COLUMNS)
      .where(visible)
      .orderBy(resolvedIdColumn, "asc")
      .limit(normalizedLimit + 1);

    if (normalizedCursor > 0) {
      query = query.where(resolvedIdColumn, ">", normalizedCursor);
    }

    const rows = await query;
    const hasMore = rows.length > normalizedLimit;
    const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
    const items = pageRows.map((row) => mapRecordRow(row));

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

    return mapRecordRow(row);
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const timestamp = toInsertDateTime();
    const insertPayload = buildWritePayload(payload);
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
    const dbPatch = buildWritePayload(patch);
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
