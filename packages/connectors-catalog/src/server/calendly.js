import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { calendlyDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const id = { type: "string", required: true, minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" };
const text = { type: "string", minLength: 1, maxLength: 1000 };
const email = { ...text, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" };
const date = { ...text, validator: value => /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value)) || "Use a UTC ISO timestamp ending in Z." };
const page = { count: { type: "integer", min: 1, max: 100, defaultTo: 20 }, page_token: { type: "string", maxLength: 4096 } };
const status = { type: "string", enum: ["active", "canceled"] };
const record = result => typeof result?.resource?.uri === "string";
const collection = result => Array.isArray(result?.collection) && Number.isInteger(result?.pagination?.count);
function uri(kind) { return { type: "string", maxLength: 2048, pattern: `^https://api\\.calendly\\.com/${kind}/[A-Za-z0-9_-]+$` }; }
function operation(method, endpoint, fields, scope, validateResult, prepare = value => value) {
  const schema = createSchema(fields);
  return { scopes: [scope], request(input) {
    const { uuid, invitee_uuid, ...values } = prepare(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
    const url = new URL(`https://api.calendly.com/${endpoint.replace("{uuid}", uuid || "").replace("{invitee_uuid}", invitee_uuid || "")}`);
    if (method === "GET") { for (const [key, value] of Object.entries(values)) url.searchParams.set(key, String(value)); return { method, url: url.href }; }
    return { method, url: url.href, ...(method === "POST" ? { body: values } : {}) };
  }, validateResult };
}
const calendlyProvider = Object.freeze({
  ...calendlyDefinition, apiOrigins: ["https://api.calendly.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  oauth: {
    issuer: "https://auth.calendly.com",
    authorization_endpoint: "https://auth.calendly.com/oauth/authorize",
    token_endpoint: "https://auth.calendly.com/oauth/token"
  },
  checkOperation: "profile.read",
  operations: {
    "eventTypes.get": operation("GET", "event_types/{uuid}", { uuid: id }, "event_types:read", record),
    "availability.list": operation("GET", "event_type_available_times", { event_type: { ...uri("event_types"), required: true },
      start_time: { ...date, required: true }, end_time: { ...date, required: true }
    }, "availability:read", result => Array.isArray(result?.collection), value => {
      const span = Date.parse(value.end_time) - Date.parse(value.start_time);
      if (span <= 0 || span > 31 * 86400000) throw new ConnectorError("connector_input_invalid", "Choose a positive range of at most 31 days.", { statusCode: 422 }); return value;
    }),
    "events.list": operation("GET", "scheduled_events", { user: uri("users"), organization: uri("organizations"), group: uri("groups"),
      invitee_email: email, status, ...page, sort: { type: "string", enum: ["start_time:asc", "start_time:desc"] }, min_start_time: date, max_start_time: date
    }, "scheduled_events:read", collection, value => {
      if (!(value.user || value.organization || value.group)) throw new ConnectorError("connector_input_invalid", "Choose the user, organization or group whose events to read.", { statusCode: 422 }); return value;
    }),
    "events.get": operation("GET", "scheduled_events/{uuid}", { uuid: id }, "scheduled_events:read", record),
    "events.cancel": operation("POST", "scheduled_events/{uuid}/cancellation", { uuid: id, reason: { ...text, maxLength: 10000 } },
      "scheduled_events:write", result => typeof result?.resource?.canceled_by === "string" && typeof result.resource.created_at === "string"),
    "invitees.list": operation("GET", "scheduled_events/{uuid}/invitees", { uuid: id, ...page, status, email,
      sort: { type: "string", enum: ["created_at:asc", "created_at:desc"] } }, "scheduled_events:read", collection),
    "invitees.get": operation("GET", "scheduled_events/{uuid}/invitees/{invitee_uuid}", { uuid: id, invitee_uuid: id }, "scheduled_events:read", record),
    "invitees.create": operation("POST", "invitees", { event_type: { ...uri("event_types"), required: true }, start_time: { ...date, required: true },
      invitee: { type: "object", required: true, schema: createSchema({ email: { ...email, required: true }, name: text,
        timezone: { ...text, required: true, validator: value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return "Choose an IANA timezone."; } } } }) },
      questions_and_answers: { type: "array", items: { type: "object", schema: createSchema({ question: { ...text, required: true }, answer: { ...text, required: true }, position: { type: "integer", required: true, min: 0 } }) },
        validator: value => value.length <= 100 || "Use at most 100 answers." },
      event_guests: { type: "array", items: email, validator: value => value.length <= 10 || "Use at most 10 guests." }
    }, "scheduled_events:write", record),
    "schedulingLinks.create": operation("POST", "scheduling_links", { owner: { ...uri("event_types"), required: true },
      owner_type: { type: "string", enum: ["EventType"], defaultTo: "EventType" }, max_event_count: { type: "integer", enum: [1], defaultTo: 1 }
    }, "scheduling_links:write", result => typeof result?.resource?.booking_url === "string" && typeof result.resource.owner === "string"),
    "noShows.create": operation("POST", "invitee_no_shows", { invitee: { type: "string", required: true,
      pattern: "^https://api\\.calendly\\.com/scheduled_events/[A-Za-z0-9_-]+/invitees/[A-Za-z0-9_-]+$" } }, "scheduled_events:write", record),
    "noShows.get": operation("GET", "invitee_no_shows/{uuid}", { uuid: id }, "scheduled_events:read", record),
    "noShows.delete": operation("DELETE", "invitee_no_shows/{uuid}", { uuid: id }, "scheduled_events:write", result => result === null),
    "profile.read": { ...jsonOperation("https://api.calendly.com/users/me", {},
      (result) => typeof result?.resource?.uri === "string" && typeof result.resource.name === "string"), scopes: ["users:read"] },
    "eventTypes.list": { ...jsonOperation("https://api.calendly.com/event_types", {
      user: { type: "string", required: true, minLength: 1, maxLength: 2048 },
      count: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      page_token: { type: "string", maxLength: 4096 },
      active: { type: "boolean" }
    }, (result) => Array.isArray(result?.collection) && Number.isInteger(result.pagination?.count)), scopes: ["event_types:read"] }
  }
});
export { calendlyProvider };
