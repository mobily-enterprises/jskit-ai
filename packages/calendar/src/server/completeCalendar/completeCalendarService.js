import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeDateInput, toDatabaseDateTimeUtc } from "@jskit-ai/database-runtime/shared";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const CALENDAR_EVENT_STATUSES = Object.freeze(["scheduled", "completed", "cancelled"]);
const CALENDAR_EVENT_STATUS_SET = new Set(CALENDAR_EVENT_STATUSES);

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeStatus(value, fallback = "scheduled") {
  const normalized = normalizeText(value).toLowerCase();
  return CALENDAR_EVENT_STATUS_SET.has(normalized) ? normalized : fallback;
}

function toDateOrThrow(value, errorMessage) {
  const date = normalizeDateInput(value);
  if (!date) {
    throw new AppError(400, errorMessage);
  }
  return date;
}

function resolveWeekWindow(weekStartLike) {
  const anchorDate = normalizeDateInput(weekStartLike) || new Date();
  const utcStartOfDay = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate()));
  const utcDay = utcStartOfDay.getUTCDay();
  const moveToMonday = utcDay === 0 ? -6 : 1 - utcDay;

  utcStartOfDay.setUTCDate(utcStartOfDay.getUTCDate() + moveToMonday);

  const utcEndOfWeek = new Date(utcStartOfDay);
  utcEndOfWeek.setUTCDate(utcEndOfWeek.getUTCDate() + 7);

  return {
    weekStart: utcStartOfDay.toISOString(),
    weekEnd: utcEndOfWeek.toISOString(),
    fromDateTime: toDatabaseDateTimeUtc(utcStartOfDay),
    toDateTime: toDatabaseDateTimeUtc(utcEndOfWeek)
  };
}

function validateEventRange(startsAtLike, endsAtLike) {
  const startsAt = toDateOrThrow(startsAtLike, "Event start date is invalid.");
  const endsAt = toDateOrThrow(endsAtLike, "Event end date is invalid.");

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new AppError(400, "Event end must be after event start.");
  }

  return {
    startsAt,
    endsAt
  };
}

function createService({ completeCalendarRepository } = {}) {
  if (!completeCalendarRepository) {
    throw new Error("completeCalendarService requires completeCalendarRepository.");
  }

  async function requireVisibleContact(contactId, options = {}) {
    const normalizedContactId = toPositiveInteger(contactId);
    if (normalizedContactId < 1) {
      throw new AppError(400, "Contact is required.");
    }

    const contact = await completeCalendarRepository.findVisibleContactById(normalizedContactId, options);
    if (!contact) {
      throw new AppError(404, "Contact not found.");
    }

    return contact;
  }

  async function enrichEvent(eventRecord, options = {}) {
    if (!eventRecord) {
      return null;
    }

    const contact = await requireVisibleContact(eventRecord.contactId, options);

    return {
      ...eventRecord,
      contact
    };
  }

  async function listWeek(query = {}, options = {}) {
    const weekWindow = resolveWeekWindow(query.weekStart);
    const contactId = toPositiveInteger(query.contactId);

    const events = await completeCalendarRepository.listWeek(
      {
        fromDateTime: weekWindow.fromDateTime,
        toDateTime: weekWindow.toDateTime,
        contactId
      },
      options
    );

    const contacts = await completeCalendarRepository.findVisibleContactsByIds(
      events.map((eventRecord) => eventRecord.contactId),
      options
    );

    const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
    const items = events.map((eventRecord) => {
      const contact = contactsById.get(eventRecord.contactId);

      return {
        ...eventRecord,
        contact:
          contact || {
            id: eventRecord.contactId,
            name: "",
            surname: ""
          }
      };
    });

    return {
      weekStart: weekWindow.weekStart,
      weekEnd: weekWindow.weekEnd,
      items
    };
  }

  async function getEvent(eventId, options = {}) {
    const eventRecord = await completeCalendarRepository.findById(eventId, options);
    if (!eventRecord) {
      throw new AppError(404, "Calendar event not found.");
    }

    return enrichEvent(eventRecord, options);
  }

  async function createEvent(payload = {}, options = {}) {
    const title = normalizeText(payload.title);
    if (!title) {
      throw new AppError(400, "Event title is required.");
    }

    const normalizedPayload = {
      contactId: toPositiveInteger(payload.contactId),
      title,
      notes: normalizeText(payload.notes),
      startsAt: normalizeText(payload.startsAt),
      endsAt: normalizeText(payload.endsAt),
      status: normalizeStatus(payload.status)
    };

    await requireVisibleContact(normalizedPayload.contactId, options);
    validateEventRange(normalizedPayload.startsAt, normalizedPayload.endsAt);

    const created = await completeCalendarRepository.create(normalizedPayload, options);
    if (!created) {
      throw new Error("completeCalendarService could not load the created event.");
    }

    return enrichEvent(created, options);
  }

  async function updateEvent(eventId, patch = {}, options = {}) {
    const existing = await completeCalendarRepository.findById(eventId, options);
    if (!existing) {
      throw new AppError(404, "Calendar event not found.");
    }

    const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
    const normalizedPatch = {};

    if (Object.hasOwn(source, "contactId")) {
      normalizedPatch.contactId = toPositiveInteger(source.contactId);
      await requireVisibleContact(normalizedPatch.contactId, options);
    }

    if (Object.hasOwn(source, "title")) {
      const title = normalizeText(source.title);
      if (!title) {
        throw new AppError(400, "Event title is required.");
      }
      normalizedPatch.title = title;
    }

    if (Object.hasOwn(source, "notes")) {
      normalizedPatch.notes = normalizeText(source.notes);
    }

    if (Object.hasOwn(source, "startsAt")) {
      normalizedPatch.startsAt = normalizeText(source.startsAt);
    }

    if (Object.hasOwn(source, "endsAt")) {
      normalizedPatch.endsAt = normalizeText(source.endsAt);
    }

    if (Object.hasOwn(source, "status")) {
      normalizedPatch.status = normalizeStatus(source.status, existing.status);
    }

    const nextStartsAt = Object.hasOwn(normalizedPatch, "startsAt") ? normalizedPatch.startsAt : existing.startsAt;
    const nextEndsAt = Object.hasOwn(normalizedPatch, "endsAt") ? normalizedPatch.endsAt : existing.endsAt;
    validateEventRange(nextStartsAt, nextEndsAt);

    const updated = await completeCalendarRepository.updateById(eventId, normalizedPatch, options);
    if (!updated) {
      throw new AppError(404, "Calendar event not found.");
    }

    return enrichEvent(updated, options);
  }

  async function deleteEvent(eventId, options = {}) {
    const deleted = await completeCalendarRepository.deleteById(eventId, options);
    if (!deleted) {
      throw new AppError(404, "Calendar event not found.");
    }

    return deleted;
  }

  return Object.freeze({
    listWeek,
    getEvent,
    createEvent,
    updateEvent,
    deleteEvent
  });
}

export { createService };
