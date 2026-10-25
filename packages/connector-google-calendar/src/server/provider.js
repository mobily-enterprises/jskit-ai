import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { googleCalendarDefinition, googleScope } from "../shared/definition.js";

const calendarIdField = { type: "string", minLength: 1, maxLength: 1024, defaultTo: "primary" };
const listSchema = createSchema({
  pageToken: { type: "string", maxLength: 4096 },
  maxResults: { type: "integer", min: 1, max: 250, defaultTo: 100 }
});
const eventsSchema = createSchema({
  calendarId: calendarIdField,
  pageToken: { type: "string", maxLength: 4096 },
  maxResults: { type: "integer", min: 1, max: 2500, defaultTo: 100 },
  timeMin: { type: "dateTime" },
  timeMax: { type: "dateTime" }
});

function queryUrl(path, input) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/${path}`);
  for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, String(value));
  return { method: "GET", url: url.href };
}

const writeScopes = ["calendar.events", "calendar", "calendar.events.owned", "calendar.app.created"].map(googleScope);
const readScopes = ["calendar.events.readonly", "calendar.events", "calendar.readonly", "calendar", "calendar.events.owned", "calendar.events.owned.readonly", "calendar.app.created"].map(googleScope);
const calendarListScopes = ["calendar.calendarlist.readonly", "calendar.calendarlist", "calendar.readonly", "calendar"].map(googleScope);
const eventListScopes = ["calendar.events.readonly", "calendar.events", "calendar.readonly", "calendar"].map(googleScope);
const calendarSchema = createSchema({ calendarId: calendarIdField });
const targetSchema = createSchema({
  calendarId: calendarIdField,
  eventId: { type: "string", minLength: 1, maxLength: 1024, required: true }
});
function invalid(message) { throw Object.assign(new Error(message), { statusCode: 422 }); }
function validateEventTime(point) {
  if (typeof point !== "object" || Array.isArray(point) || Object.keys(point).some(key => !["date", "dateTime", "timeZone"].includes(key))) invalid("Use date or dateTime and optional timeZone.");
  if (Boolean(point.date) === Boolean(point.dateTime)) invalid("Choose an all-day date or a timed dateTime.");
  if (point.date && (typeof point.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(point.date) ||
    !Number.isFinite(Date.parse(point.date)) || new Date(point.date).toISOString().slice(0, 10) !== point.date)) invalid("Invalid all-day date.");
  if (point.dateTime && (typeof point.dateTime !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(point.dateTime) ||
    !Number.isFinite(Date.parse(point.dateTime)))) invalid("dateTime requires an explicit timezone offset.");
  if (point.timeZone !== undefined) {
    try {
      if (typeof point.timeZone !== "string") throw new Error();
      new Intl.DateTimeFormat("en", { timeZone: point.timeZone });
    } catch { invalid("Use an IANA timeZone."); }
  }
}
function validateRecurrence(body) {
  const { recurrence } = body;
  if (!Array.isArray(recurrence) || recurrence.length > 100 || recurrence.some(line => typeof line !== "string" ||
    line.length > 2048 || !/^(RRULE|RDATE|EXRULE|EXDATE)[:;]/.test(line) || /[\r\n]/.test(line))) invalid("recurrence must be an array of RFC5545 recurrence lines.");
  if (recurrence.length && body.start?.dateTime && (!body.start.timeZone || !body.end.timeZone)) invalid("Timed recurrence requires start/end timeZone.");
  if (recurrence.length && !body.start) invalid("Supply start and end when setting recurrence.");
}
function validAttendee(person) {
  return person && typeof person.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(person.email) &&
    Object.keys(person).every(key => ["email", "displayName", "optional"].includes(key)) &&
    (person.displayName === undefined || typeof person.displayName === "string") &&
    (person.optional === undefined || typeof person.optional === "boolean");
}
function validateAttendees(attendees) {
  if (!Array.isArray(attendees) || attendees.length > 200 || !attendees.every(validAttendee)) {
    invalid("attendees requires up to 200 email entries with optional displayName/optional.");
  }
}
function eventBody(body, creating) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalid("event must be an object.");
  const allowed = ["summary", "description", "location", "start", "end", "recurrence", "attendees", "transparency", "visibility"];
  if (!Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) invalid("Use supported event fields only.");
  for (const key of ["summary", "description", "location"]) if (body[key] !== undefined && (typeof body[key] !== "string" || body[key].length > 16384)) invalid(`${key} must be text of at most 16384 characters.`);
  if (creating && (!body.start || !body.end)) invalid("start and end are required.");
  if (Boolean(body.start) !== Boolean(body.end)) invalid("Supply start and end together when changing event times.");
  for (const point of [body.start, body.end].filter(Boolean)) validateEventTime(point);
  if (body.start && (Boolean(body.start.date) !== Boolean(body.end.date) || Date.parse(body.end.date || body.end.dateTime) <= Date.parse(body.start.date || body.start.dateTime))) invalid("Use matching date types with end after start; all-day end is exclusive.");
  if (body.recurrence !== undefined) validateRecurrence(body);
  if (body.attendees !== undefined) validateAttendees(body.attendees);
  if (body.transparency !== undefined && !["opaque", "transparent"].includes(body.transparency)) invalid("Invalid transparency.");
  if (body.visibility !== undefined && !["default", "public", "private", "confidential"].includes(body.visibility)) invalid("Invalid visibility.");
  return body;
}
function writeEvent(method) {
  return {
    scopes: writeScopes,
    validateResult: result => method === "DELETE" ? result === null : result?.kind === "calendar#event" && typeof result.id === "string",
    request(input = {}) {
      const { event, sendUpdates, ifMatch, ...target } = input;
      if (!["all", "externalOnly", "none"].includes(sendUpdates)) invalid("Choose sendUpdates explicitly: all, externalOnly or none.");
      if (ifMatch !== undefined && (typeof ifMatch !== "string" || !ifMatch || ifMatch.length > 1024 || /[\r\n]/.test(ifMatch))) invalid("Invalid event ETag.");
      if (method === "DELETE" && event !== undefined) invalid("Cancellation has no event body.");
      const { calendarId, eventId } = validateSchemaPayload({ schema: method === "POST" ? calendarSchema : targetSchema, mode: "replace" }, target, { statusCode: 422 });
      const request = queryUrl(`calendars/${encodeURIComponent(calendarId)}/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`, { sendUpdates });
      return { ...request, method, ...(ifMatch ? { headers: { "If-Match": ifMatch } } : {}), ...(method !== "DELETE" ? { body: eventBody(event, method === "POST") } : {}) };
    }
  };
}

const googleCalendarProvider = Object.freeze({
  ...googleCalendarDefinition,
  oauth: {
    issuer: "https://accounts.google.com",
    authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    token_endpoint: "https://oauth2.googleapis.com/token",
    revocation_endpoint: "https://oauth2.googleapis.com/revoke"
  },
  authorizationParameters: { access_type: "offline", prompt: "consent" },
  apiOrigins: ["https://www.googleapis.com"],
  checkOperation: "calendars.list",
  operations: {
    "events.create": writeEvent("POST"),
    "events.update": writeEvent("PATCH"),
    "events.cancel": writeEvent("DELETE"),
    "events.get": {
      scopes: readScopes,
      validateResult: result => result?.kind === "calendar#event" && typeof result.id === "string",
      request(input) {
        const { calendarId, eventId } = validateSchemaPayload({ schema: targetSchema, mode: "replace" }, input, { statusCode: 422 });
        return queryUrl(`calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {});
      }
    },
    "calendars.list": {
      scopes: calendarListScopes,
      validateResult: (result) => result?.kind === "calendar#calendarList" && (result.items === undefined || Array.isArray(result.items)),
      request(input) {
        return queryUrl("users/me/calendarList", validateSchemaPayload({ schema: listSchema, mode: "replace" }, input, { statusCode: 422 }));
      }
    },
    "events.list": {
      scopes: eventListScopes,
      validateResult: (result) => result?.kind === "calendar#events" && (result.items === undefined || Array.isArray(result.items)),
      request(input) {
        const { calendarId, ...query } = validateSchemaPayload({ schema: eventsSchema, mode: "replace" }, input, { statusCode: 422 });
        return queryUrl(`calendars/${encodeURIComponent(calendarId)}/events`, { ...query, singleEvents: true, orderBy: "startTime" });
      }
    }
  }
});

export { googleCalendarProvider };
