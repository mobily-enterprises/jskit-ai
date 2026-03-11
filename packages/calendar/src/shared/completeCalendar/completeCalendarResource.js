import { Type } from "typebox";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const CALENDAR_EVENT_STATUSES = Object.freeze(["scheduled", "completed", "cancelled"]);

const positiveIntegerSchema = Type.Integer({ minimum: 1 });

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCalendarEventStatus(value, fallback = "scheduled") {
  const normalized = normalizeText(value).toLowerCase();
  return CALENDAR_EVENT_STATUSES.includes(normalized) ? normalized : fallback;
}

function normalizeContactSummary(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: toPositiveInteger(source.id),
    name: normalizeText(source.name),
    surname: normalizeText(source.surname)
  };
}

function normalizeCalendarEventRecord(payload = {}) {
  const source = normalizeObjectInput(payload);

  return {
    id: toPositiveInteger(source.id),
    contactId: toPositiveInteger(source.contactId),
    title: normalizeText(source.title),
    notes: normalizeText(source.notes),
    startsAt: normalizeText(source.startsAt),
    endsAt: normalizeText(source.endsAt),
    status: normalizeCalendarEventStatus(source.status),
    contact: normalizeContactSummary(source.contact),
    createdAt: normalizeText(source.createdAt),
    updatedAt: normalizeText(source.updatedAt)
  };
}

function normalizeCalendarEventInput(payload = {}) {
  const source = normalizeObjectInput(payload);
  const normalized = {};

  if (Object.hasOwn(source, "contactId")) {
    normalized.contactId = toPositiveInteger(source.contactId);
  }

  if (Object.hasOwn(source, "title")) {
    normalized.title = normalizeText(source.title);
  }

  if (Object.hasOwn(source, "notes")) {
    normalized.notes = normalizeText(source.notes);
  }

  if (Object.hasOwn(source, "startsAt")) {
    normalized.startsAt = normalizeText(source.startsAt);
  }

  if (Object.hasOwn(source, "endsAt")) {
    normalized.endsAt = normalizeText(source.endsAt);
  }

  if (Object.hasOwn(source, "status")) {
    normalized.status = normalizeCalendarEventStatus(source.status);
  }

  return normalized;
}

const contactSummaryValidator = Object.freeze({
  schema: Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      name: Type.String({ minLength: 1, maxLength: 160 }),
      surname: Type.String({ minLength: 1, maxLength: 160 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeContactSummary
});

const calendarEventRecordValidator = Object.freeze({
  schema: Type.Object(
    {
      id: Type.Integer({ minimum: 1 }),
      contactId: Type.Integer({ minimum: 1 }),
      title: Type.String({ minLength: 1, maxLength: 200 }),
      notes: Type.String({ maxLength: 4000 }),
      startsAt: Type.String({ minLength: 1 }),
      endsAt: Type.String({ minLength: 1 }),
      status: Type.Union(CALENDAR_EVENT_STATUSES.map((entry) => Type.Literal(entry))),
      contact: contactSummaryValidator.schema,
      createdAt: Type.String({ minLength: 1 }),
      updatedAt: Type.String({ minLength: 1 })
    },
    { additionalProperties: false }
  ),
  normalize: normalizeCalendarEventRecord
});

const calendarEventBodySchema = Type.Object(
  {
    contactId: positiveIntegerSchema,
    title: Type.String({
      minLength: 1,
      maxLength: 200,
      messages: {
        required: "Event title is required.",
        minLength: "Event title is required.",
        maxLength: "Event title must be at most 200 characters.",
        default: "Event title is required."
      }
    }),
    notes: Type.Optional(
      Type.String({
        maxLength: 4000,
        messages: {
          maxLength: "Notes must be at most 4000 characters.",
          default: "Invalid notes value."
        }
      })
    ),
    startsAt: Type.String({ minLength: 1 }),
    endsAt: Type.String({ minLength: 1 }),
    status: Type.Optional(Type.Union(CALENDAR_EVENT_STATUSES.map((entry) => Type.Literal(entry))))
  },
  {
    additionalProperties: false,
    messages: {
      additionalProperties: "Unexpected field.",
      default: "Invalid value."
    }
  }
);

const completeCalendarResource = {
  resource: "completeCalendar",
  messages: {
    validation: "Fix invalid calendar values and try again.",
    saveSuccess: "Calendar event saved.",
    saveError: "Unable to save calendar event.",
    deleteSuccess: "Calendar event deleted.",
    deleteError: "Unable to delete calendar event.",
    moveSuccess: "Calendar event moved.",
    moveError: "Unable to move calendar event."
  },
  operations: {
    list: {
      method: "GET",
      output: {
        schema: Type.Object(
          {
            weekStart: Type.String({ minLength: 1 }),
            weekEnd: Type.String({ minLength: 1 }),
            items: Type.Array(calendarEventRecordValidator.schema)
          },
          { additionalProperties: false }
        ),
        normalize(payload = {}) {
          const source = normalizeObjectInput(payload);

          return {
            weekStart: normalizeText(source.weekStart),
            weekEnd: normalizeText(source.weekEnd),
            items: Array.isArray(source.items)
              ? source.items.map((entry) => calendarEventRecordValidator.normalize(entry))
              : []
          };
        }
      }
    },
    view: {
      method: "GET",
      output: calendarEventRecordValidator
    },
    create: {
      method: "POST",
      body: {
        schema: calendarEventBodySchema,
        normalize: normalizeCalendarEventInput
      },
      output: calendarEventRecordValidator
    },
    patch: {
      method: "PATCH",
      body: {
        schema: Type.Partial(calendarEventBodySchema, { additionalProperties: false }),
        normalize: normalizeCalendarEventInput
      },
      output: calendarEventRecordValidator
    },
    delete: {
      method: "DELETE",
      output: {
        schema: Type.Object(
          {
            id: Type.Integer({ minimum: 1 }),
            deleted: Type.Literal(true)
          },
          { additionalProperties: false }
        ),
        normalize(payload = {}) {
          const source = normalizeObjectInput(payload);

          return {
            id: toPositiveInteger(source.id),
            deleted: true
          };
        }
      }
    }
  }
};

export { completeCalendarResource };
