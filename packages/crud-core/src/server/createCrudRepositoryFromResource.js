import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_LIST_LIMIT,
  buildRepositoryColumnMetadata,
  applyCrudListQueryFilters,
  deriveRepositoryMappingFromResource,
  normalizeCrudListLimit,
  requireCrudTableName,
  buildWritePayload,
  mapRecordRow,
  resolveColumnName,
  resolveCrudIdColumn
} from "./repositorySupport.js";

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

function createCrudRepositoryFromResource(resource = {}, { context = "crudRepository" } = {}) {
  const repositoryMapping = deriveRepositoryMappingFromResource(resource, { context });
  const defaults = resolveRepositoryDefaults(resource, repositoryMapping);
  const { selectColumns: SELECT_COLUMNS } = buildRepositoryColumnMetadata({
    outputKeys: repositoryMapping.outputKeys,
    writeKeys: repositoryMapping.writeKeys,
    columnOverrides: repositoryMapping.columnOverrides
  });
  const {
    outputKeys: OUTPUT_KEYS,
    writeKeys: WRITE_KEYS,
    columnOverrides: COLUMN_OVERRIDES,
    listSearchColumns: LIST_SEARCH_COLUMNS
  } = repositoryMapping;

  return function createRepository(
    knex,
    {
      tableName = defaults.tableName,
      idColumn = defaults.idColumn
    } = {}
  ) {
    if (typeof knex !== "function") {
      throw new TypeError("crudRepository requires knex.");
    }

    const resolvedTableName = requireCrudTableName(tableName);
    const resolvedIdColumn = resolveCrudIdColumn(idColumn, { fallback: defaults.idColumn });

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
      const items = pageRows.map((row) => mapRecordRow(row, OUTPUT_KEYS, COLUMN_OVERRIDES));

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

      return mapRecordRow(row, OUTPUT_KEYS, COLUMN_OVERRIDES);
    }

    async function create(payload = {}, options = {}) {
      const client = options?.trx || knex;
      const timestamp = toInsertDateTime();
      const insertPayload = buildWritePayload(payload, WRITE_KEYS, COLUMN_OVERRIDES);
      if (defaults.createdAtColumn && !Object.hasOwn(insertPayload, defaults.createdAtColumn)) {
        insertPayload[defaults.createdAtColumn] = timestamp;
      }
      if (defaults.updatedAtColumn && !Object.hasOwn(insertPayload, defaults.updatedAtColumn)) {
        insertPayload[defaults.updatedAtColumn] = timestamp;
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
      const dbPatch = buildWritePayload(patch, WRITE_KEYS, COLUMN_OVERRIDES);
      const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
      if (defaults.updatedAtColumn) {
        dbPatch[defaults.updatedAtColumn] = toInsertDateTime();
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
  };
}

export { createCrudRepositoryFromResource };
