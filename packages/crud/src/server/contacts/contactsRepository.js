import { toInsertDateTime, toIsoString } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function mapContactRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    surname: String(row.surname || "").trim(),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function normalizeListLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.min(parsed, MAX_LIST_LIMIT);
}

function createRepository(knex, { tableName = "contacts" } = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("contactsRepository requires knex.");
  }

  const resolvedTableName = String(tableName || "").trim() || "contacts";

  async function list({ cursor = 0, limit = DEFAULT_LIST_LIMIT } = {}, options = {}) {
    const client = options?.trx || knex;
    const normalizedCursor = Number.isInteger(Number(cursor)) && Number(cursor) > 0 ? Number(cursor) : 0;
    const normalizedLimit = normalizeListLimit(limit);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    let query = client(resolvedTableName)
      .select("id", "name", "surname", "created_at", "updated_at")
      .where(visible)
      .orderBy("id", "asc")
      .limit(normalizedLimit + 1);

    if (normalizedCursor > 0) {
      query = query.where("id", ">", normalizedCursor);
    }

    const rows = await query;
    const hasMore = rows.length > normalizedLimit;
    const pageRows = hasMore ? rows.slice(0, normalizedLimit) : rows;
    const items = pageRows.map((row) => mapContactRow(row));

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? String(items[items.length - 1].id) : null
    };
  }

  async function findById(contactId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const row = await client(resolvedTableName)
      .select("id", "name", "surname", "created_at", "updated_at")
      .where(visible)
      .where({ id: Number(contactId) })
      .first();

    return mapContactRow(row);
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(payload);
    const timestamp = toInsertDateTime();
    const insertPayload = applyVisibilityOwners(
      {
        name: source.name,
        surname: source.surname,
        created_at: timestamp,
        updated_at: timestamp
      },
      options.visibilityContext
    );
    const [contactId] = await client(resolvedTableName).insert({
      ...insertPayload
    });

    return findById(contactId, {
      ...options,
      trx: client
    });
  }

  async function updateById(contactId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(patch);
    const dbPatch = pickOwnProperties(source, ["name", "surname"]);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    if (Object.keys(dbPatch).length === 0) {
      return findById(contactId, {
        ...options,
        trx: client
      });
    }

    await client(resolvedTableName)
      .where(visible)
      .where({ id: Number(contactId) })
      .update({
        ...dbPatch,
        updated_at: toInsertDateTime()
      });

    return findById(contactId, {
      ...options,
      trx: client
    });
  }

  async function deleteById(contactId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const existing = await findById(contactId, {
      ...options,
      trx: client
    });

    if (!existing) {
      return null;
    }

    await client(resolvedTableName).where(visible).where({ id: Number(contactId) }).delete();

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
