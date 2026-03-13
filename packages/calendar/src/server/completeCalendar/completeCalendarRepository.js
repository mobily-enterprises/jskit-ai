import { toInsertDateTime, toIsoString } from "@jskit-ai/database-runtime/shared";
import { applyVisibility, applyVisibilityOwners } from "@jskit-ai/database-runtime/shared/visibility";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";

function toUtcIsoFromDatabaseDateTime(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
        value.getMilliseconds()
      )
    ).toISOString();
  }

  const normalized = String(value).trim().replace("T", " ").replace(/Z$/i, "");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
  );

  if (match) {
    const [, year, month, day, hours, minutes, seconds = "0", milliseconds = "0"] = match;
    const utcDate = new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hours),
        Number(minutes),
        Number(seconds),
        Number(milliseconds.padEnd(3, "0"))
      )
    );
    return utcDate.toISOString();
  }

  return toIsoString(value);
}

function mapEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    contactId: Number(row.contact_id),
    title: String(row.title || "").trim(),
    notes: String(row.notes || ""),
    startsAt: toUtcIsoFromDatabaseDateTime(row.starts_at),
    endsAt: toUtcIsoFromDatabaseDateTime(row.ends_at),
    status: String(row.status || "scheduled").trim().toLowerCase() || "scheduled",
    createdAt: toUtcIsoFromDatabaseDateTime(row.created_at),
    updatedAt: toUtcIsoFromDatabaseDateTime(row.updated_at)
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

function createRepository(knex, options = {}) {
  if (typeof knex !== "function") {
    throw new TypeError("completeCalendarRepository requires knex.");
  }
  const contactsTableName = String(options.contactsTableName || "").trim() || "contacts";

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

    const row = await client(contactsTableName)
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

    const rows = await client(contactsTableName)
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
