import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import { getClientAppConfig } from "@jskit-ai/kernel/client";
import { normalizeQueryToken, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveShellLinkPath } from "@jskit-ai/shell-web/client/navigation/linkResolver";
import { completeCalendarResource } from "../../shared/completeCalendar/completeCalendarResource.js";
import { resolveCalendarContactsCrudConfig } from "../../shared/completeCalendar/completeCalendarCrudConfig.js";

function createCalendarEventForm() {
  return {
    contactId: 0,
    title: "",
    notes: "",
    startsAt: "",
    endsAt: "",
    status: "scheduled"
  };
}

function assignCalendarEventToForm(model, payload = {}) {
  model.contactId = Number(payload.contactId || 0);
  model.title = String(payload.title || "");
  model.notes = String(payload.notes || "");
  model.startsAt = toLocalDateTimeInput(payload.startsAt);
  model.endsAt = toLocalDateTimeInput(payload.endsAt);
  model.status = String(payload.status || "scheduled");
}

function buildCalendarEventPayload(model) {
  return {
    contactId: Number(model.contactId || 0),
    title: String(model.title || ""),
    notes: String(model.notes || ""),
    startsAt: fromLocalDateTimeInput(model.startsAt),
    endsAt: fromLocalDateTimeInput(model.endsAt),
    status: String(model.status || "scheduled")
  };
}

function parseCreateCalendarEventInput(rawPayload) {
  return validateOperationSection({
    operation: completeCalendarResource.operations.create,
    section: "body",
    value: rawPayload
  });
}

function parsePatchCalendarEventInput(rawPayload) {
  return validateOperationSection({
    operation: completeCalendarResource.operations.patch,
    section: "body",
    value: rawPayload
  });
}

function calendarWeekQueryKey(surfaceId = "", workspaceSlug = "", weekStart = "", contactId = 0) {
  return [
    "calendar",
    "completeCalendar",
    "week",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    normalizeQueryToken(weekStart),
    Number(contactId) || 0
  ];
}

function calendarEventQueryKey(surfaceId = "", workspaceSlug = "", eventId = 0) {
  return [
    "calendar",
    "completeCalendar",
    "event",
    normalizeQueryToken(surfaceId),
    normalizeQueryToken(workspaceSlug),
    Number(eventId) || 0
  ];
}

function resolveAdminCalendarWeekPath(context = null, workspaceSlug = "") {
  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug,
    relativePath: "/calendar",
    mode: "auto"
  });
}

function resolveAdminCalendarEventViewPath(eventIdLike, context = null, workspaceSlug = "") {
  const eventId = Number(eventIdLike);
  if (!Number.isInteger(eventId) || eventId < 1) {
    return "";
  }

  return resolveShellLinkPath({
    context,
    surface: "admin",
    workspaceSlug,
    relativePath: `/calendar/events/${eventId}`,
    mode: "auto"
  });
}

function toRouteEventId(value) {
  if (Array.isArray(value)) {
    return toRouteEventId(value[0]);
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function toDateOnlyIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveWeekStartDateIso(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return toDateOnlyIso(new Date());
  }

  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);

  return toDateOnlyIso(date);
}

function toLocalDateTimeInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalDateTimeInput(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function toContactOption(contact = {}) {
  const id = Number(contact.id);
  const name = normalizeText(contact.name);
  const surname = normalizeText(contact.surname);

  if (!Number.isInteger(id) || id < 1) {
    return null;
  }

  return {
    id,
    label: `${name} ${surname}`.trim() || `Contact #${id}`
  };
}

function resolveCalendarContactsListApiSuffix(limit = 200) {
  const appConfig = getClientAppConfig();
  const crudConfig = resolveCalendarContactsCrudConfig(appConfig);
  const normalizedLimit = Number(limit);
  const pageLimit = Number.isInteger(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 200;
  return `${crudConfig.relativePath}?limit=${pageLimit}`;
}

export {
  completeCalendarResource,
  createCalendarEventForm,
  assignCalendarEventToForm,
  buildCalendarEventPayload,
  parseCreateCalendarEventInput,
  parsePatchCalendarEventInput,
  calendarWeekQueryKey,
  calendarEventQueryKey,
  resolveAdminCalendarWeekPath,
  resolveAdminCalendarEventViewPath,
  resolveWeekStartDateIso,
  toDateOnlyIso,
  toRouteEventId,
  toLocalDateTimeInput,
  fromLocalDateTimeInput,
  toContactOption,
  resolveCalendarContactsListApiSuffix
};
