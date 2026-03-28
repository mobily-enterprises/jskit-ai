import { toInsertDateTime } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import {
  DEFAULT_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName
} from "@jskit-ai/crud-core/server/repositorySupport";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function mapRecordRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    textField: row.text_field,
    dateField: row.date_field,
    numberField: row.number_field,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createRepository(knex, { tableName } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("crudRepository requires knex.");
  }

  const resolvedTableName = requireCrudTableName(tableName);

  async function list({ cursor = 0, limit = DEFAULT_LIST_LIMIT } = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedCursor = Number.isInteger(Number(cursor)) && Number(cursor) > 0 ? Number(cursor) : 0;
    const normalizedLimit = normalizeCrudListLimit(limit);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    let query = client(resolvedTableName)
      .select("id", "text_field", "date_field", "number_field", "created_at", "updated_at")
      .where(visible)
      .orderBy("id", "asc")
      .limit(normalizedLimit + 1);

    if (normalizedCursor > 0) {
      query = query.where("id", ">", normalizedCursor);
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
      .select("id", "text_field", "date_field", "number_field", "created_at", "updated_at")
      .where(visible)
      .where({ id: Number(recordId) })
      .first();

    return mapRecordRow(row);
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(payload);
    const timestamp = toInsertDateTime();
    const insertPayload = applyVisibilityOwners(
      {
        text_field: source.textField,
        date_field: source.dateField,
        number_field: source.numberField,
        created_at: timestamp,
        updated_at: timestamp
      },
      options.visibilityContext
    );
    const [recordId] = await client(resolvedTableName).insert({
      ...insertPayload
    });

    return findById(recordId, {
      ...options,
      trx: client
    });
  }

  async function updateById(recordId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(patch);
    const dbPatch = {};
    const patchSource = pickOwnProperties(source, ["textField", "dateField", "numberField"]);
    if (Object.hasOwn(patchSource, "textField")) {
      dbPatch.text_field = patchSource.textField;
    }
    if (Object.hasOwn(patchSource, "dateField")) {
      dbPatch.date_field = patchSource.dateField;
    }
    if (Object.hasOwn(patchSource, "numberField")) {
      dbPatch.number_field = patchSource.numberField;
    }
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    if (Object.keys(dbPatch).length === 0) {
      return findById(recordId, {
        ...options,
        trx: client
      });
    }

    await client(resolvedTableName)
      .where(visible)
      .where({ id: Number(recordId) })
      .update({
        ...dbPatch,
        updated_at: toInsertDateTime()
      });

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

    await client(resolvedTableName).where(visible).where({ id: Number(recordId) }).delete();

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
