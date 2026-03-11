import { toInsertDateTime, toIsoString } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function mapEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    contactId: Number(row.contact_id),
    title: String(row.title || "").trim(),
    notes: String(row.notes || ""),
    startsAt: toIsoString(row.starts_at),
    endsAt: toIsoString(row.ends_at),
    status: String(row.status || "scheduled").trim().toLowerCase() || "scheduled",
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapContactRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    name: String(row.name || "").trim(),
    surname: String(row.surname || "").trim()
  };
}

function createRepository(knex) {
  if (typeof knex !== "function") {
    throw new TypeError("completeCalendarRepository requires knex.");
  }

  async function listWeek({ fromDateTime, toDateTime, contactId = 0 } = {}, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    let query = client("calendar_events")
      .select("id", "contact_id", "title", "notes", "starts_at", "ends_at", "status", "created_at", "updated_at")
      .where(visible)
      .where("starts_at", "<", toDateTime)
      .where("ends_at", ">", fromDateTime)
      .orderBy("starts_at", "asc")
      .orderBy("id", "asc");

    const normalizedContactId = Number(contactId);
    if (Number.isInteger(normalizedContactId) && normalizedContactId > 0) {
      query = query.where({ contact_id: normalizedContactId });
    }

    const rows = await query;
    return rows.map((row) => mapEventRow(row));
  }

  async function findById(eventId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    const row = await client("calendar_events")
      .select("id", "contact_id", "title", "notes", "starts_at", "ends_at", "status", "created_at", "updated_at")
      .where(visible)
      .where({ id: Number(eventId) })
      .first();

    return mapEventRow(row);
  }

  async function create(payload = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(payload);
    const timestamp = toInsertDateTime();
    const insertPayload = applyVisibilityOwners(
      {
        contact_id: Number(source.contactId),
        title: source.title,
        notes: source.notes,
        starts_at: toInsertDateTime(source.startsAt),
        ends_at: toInsertDateTime(source.endsAt),
        status: source.status,
        created_at: timestamp,
        updated_at: timestamp
      },
      options.visibilityContext
    );

    const [eventId] = await client("calendar_events").insert(insertPayload);

    return findById(eventId, {
      ...options,
      trx: client
    });
  }

  async function updateById(eventId, patch = {}, options = {}) {
    const client = options?.trx || knex;
    const source = normalizeObjectInput(patch);
    const dbPatch = pickOwnProperties(source, ["title", "notes", "status"]);
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    if (Object.hasOwn(source, "contactId")) {
      dbPatch.contact_id = Number(source.contactId);
    }

    if (Object.hasOwn(source, "startsAt")) {
      dbPatch.starts_at = toInsertDateTime(source.startsAt);
    }

    if (Object.hasOwn(source, "endsAt")) {
      dbPatch.ends_at = toInsertDateTime(source.endsAt);
    }

    if (Object.keys(dbPatch).length === 0) {
      return findById(eventId, {
        ...options,
        trx: client
      });
    }

    await client("calendar_events")
      .where(visible)
      .where({ id: Number(eventId) })
      .update({
        ...dbPatch,
        updated_at: toInsertDateTime()
      });

    return findById(eventId, {
      ...options,
      trx: client
    });
  }

  async function deleteById(eventId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const existing = await findById(eventId, {
      ...options,
      trx: client
    });

    if (!existing) {
      return null;
    }

    await client("calendar_events").where(visible).where({ id: Number(eventId) }).delete();

    return {
      id: existing.id,
      deleted: true
    };
  }

  async function findVisibleContactById(contactId, options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);

    const row = await client("contacts")
      .select("id", "name", "surname")
      .where(visible)
      .where({ id: Number(contactId) })
      .first();

    return mapContactRow(row);
  }

  async function findVisibleContactsByIds(contactIds = [], options = {}) {
    const client = options?.trx || knex;
    const visible = (queryBuilder) => applyVisibility(queryBuilder, options.visibilityContext);
    const normalizedIds = Array.from(
      new Set(
        (Array.isArray(contactIds) ? contactIds : [])
          .map((entry) => Number(entry))
          .filter((entry) => Number.isInteger(entry) && entry > 0)
      )
    );

    if (normalizedIds.length < 1) {
      return [];
    }

    const rows = await client("contacts")
      .select("id", "name", "surname")
      .where(visible)
      .whereIn("id", normalizedIds);

    return rows.map((row) => mapContactRow(row));
  }

  return Object.freeze({
    listWeek,
    findById,
    create,
    updateById,
    deleteById,
    findVisibleContactById,
    findVisibleContactsByIds
  });
}

export { createRepository };
