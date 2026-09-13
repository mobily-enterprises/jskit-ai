import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { resendDefinition } from "../shared/definitions.js";

const pagination = createSchema({
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  after: { type: "string", minLength: 1, maxLength: 200 }
});

const email = createSchema({
  from: { type: "string", required: true, minLength: 1, maxLength: 320, pattern: "^[^\\r\\n]+$" },
  to: { type: "array", required: true,
    validator: (value) => (value.length >= 1 && value.length <= 50) || "Provide between 1 and 50 recipients.",
    items: { type: "string", minLength: 1, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+$" } },
  subject: { type: "string", required: true, minLength: 1, maxLength: 998, pattern: "^[^\\r\\n]+$" },
  text: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1000000 },
  idempotencyKey: { type: "string", required: true, minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9_./:-]+$" }
});

const resourceId = { type: "string", required: true, minLength: 1, maxLength: 200, pattern: "^[A-Za-z0-9_-]+$" };
const shortText = { type: "string", minLength: 1, maxLength: 1000, pattern: "^[^\\r\\n]+$" };
const emailAddress = { type: "string", required: true, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+$" };
const listFields = { limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  after: { type: "string", minLength: 1, maxLength: 200 } };
const broadcastFields = { segment_id: resourceId, from: { ...shortText, required: true, maxLength: 320 },
  subject: { ...shortText, required: true, maxLength: 998 }, name: shortText,
  html: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1000000,
    validator: (value) => value.includes("{{{RESEND_UNSUBSCRIBE_URL}}}") || "Include {{{RESEND_UNSUBSCRIBE_URL}}} in the broadcast HTML." },
  text: { type: "string", noTrim: true, maxLength: 1000000 }, preview_text: shortText };
const hasId = (result) => typeof result?.id === "string" && result.id.length > 0;
const membershipResult = (result) => result?.object === "contact_segment" && typeof result.contact_id === "string" && typeof result.segment_id === "string";
const listResult = (result) => result?.object === "list" && Array.isArray(result.data);
// Fixed provider routes; the application authorizes each named operation before HTTP.
function marketingOperation(fields, method, destination, validateResult = hasId, draft = false) {
  const schema = createSchema(fields);
  return { scopes: [], request(input) {
    const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const { id, segmentId, ...body } = values;
    const url = new URL(`https://api.resend.com/${destination(values)}`);
    if (method === "GET") {
      for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value));
      return { method, url: url.href };
    }
    return { method, url: url.href, ...(method === "DELETE" ? {} : { body: draft ? { ...body, send: false } : body }) };
  }, validateResult };
}

const resendProvider = Object.freeze({
  ...resendDefinition,
  apiOrigins: ["https://api.resend.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "domains.list",
  operations: {
    "segments.list": marketingOperation(listFields, "GET", () => "segments", listResult),
    "segments.create": marketingOperation({ name: { ...shortText, required: true } }, "POST", () => "segments"),
    "contacts.list": marketingOperation({ ...listFields, segment_id: { ...resourceId, required: false } }, "GET", () => "contacts", listResult),
    "contacts.get": marketingOperation({ id: resourceId }, "GET", ({ id }) => `contacts/${id}`),
    "contacts.create": marketingOperation({ email: emailAddress, first_name: shortText, last_name: shortText,
      unsubscribed: { type: "boolean", required: true },
      segments: { type: "array", validator: (value) => value.length <= 100 || "Provide at most 100 segments.",
        items: { type: "object", properties: { id: resourceId } } } }, "POST", () => "contacts"),
    "contacts.update": marketingOperation({ id: resourceId, unsubscribed: { type: "boolean", required: true }, first_name: shortText, last_name: shortText },
      "PATCH", ({ id }) => `contacts/${id}`),
    "contacts.addSegment": marketingOperation({ id: resourceId, segmentId: resourceId }, "POST", ({ id, segmentId }) => `contacts/${id}/segments/${segmentId}`, membershipResult),
    "contacts.removeSegment": marketingOperation({ id: resourceId, segmentId: resourceId }, "DELETE", ({ id, segmentId }) => `contacts/${id}/segments/${segmentId}`, (result) => membershipResult(result) && result.deleted === true),
    "broadcasts.create": marketingOperation(broadcastFields, "POST", () => "broadcasts", hasId, true),
    "broadcasts.get": marketingOperation({ id: resourceId }, "GET", ({ id }) => `broadcasts/${id}`),
    "broadcasts.list": marketingOperation(listFields, "GET", () => "broadcasts", listResult),
    "broadcasts.update": marketingOperation({ id: resourceId, ...broadcastFields }, "PATCH", ({ id }) => `broadcasts/${id}`),
    "broadcasts.send": marketingOperation({ id: resourceId }, "POST", ({ id }) => `broadcasts/${id}/send`),
    "domains.get": marketingOperation({ id: resourceId }, "GET", ({ id }) => `domains/${id}`),
    "emails.send": {
      scopes: [],
      request(input) {
        const { idempotencyKey, ...body } = validateSchemaPayload({ schema: email, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: "https://api.resend.com/emails",
          headers: { "Idempotency-Key": idempotencyKey }, body };
      },
      validateResult: (result) => typeof result?.id === "string" && result.id.length > 0
    },
    "domains.list": {
      scopes: [],
      request(input) {
        const query = validateSchemaPayload({ schema: pagination, mode: "replace" }, input, { statusCode: 422 });
        const url = new URL("https://api.resend.com/domains");
        for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
        return { method: "GET", url: url.href };
      },
      validateResult: (result) => result?.object === "list" && Array.isArray(result.data) && typeof result.has_more === "boolean"
    }
  }
});
export { resendProvider };
