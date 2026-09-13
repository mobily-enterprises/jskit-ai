import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { brevoDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const text = { type: "string", minLength: 1, maxLength: 1000 };
const email = { ...text, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" };
const id = { type: "integer", min: 1, required: true };
const bag = { type: "object", additionalProperties: true };
const bool = { type: "boolean" };
const page = { limit: { type: "integer", min: 1, max: 50, defaultTo: 50 }, offset: { type: "integer", min: 0, defaultTo: 0 } };
const mailbox = { type: "object", schema: createSchema({ email: { ...email, required: true }, name: text }) };
const ids = { type: "array", items: { type: "integer", min: 1 }, validator: value => value.length <= 100 || "Use at most 100 list IDs." };
const emails = { type: "array", items: email, validator: value => value.length > 0 && value.length <= 150 || "Supply 1–150 email addresses." };
const domain = { type: "string", minLength: 3, maxLength: 253, pattern: "^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}$", required: true };
const empty = result => result === null || result !== null && typeof result === "object" && !Array.isArray(result) && Object.keys(result).length === 0;
const record = result => Number.isInteger(result?.id);
function operation(method, endpoint, fields, validateResult, prepare = value => value) {
  const schema = createSchema(fields);
  return { scopes: [], request(input) {
    const values = prepare(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 }));
    const { resource, ...body } = values;
    const url = new URL(`https://api.brevo.com/v3/${endpoint.replace("{resource}", encodeURIComponent(resource ?? ""))}`);
    if (method === "GET") { for (const [key, value] of Object.entries(body)) url.searchParams.set(key, String(value)); return { method, url: url.href }; }
    return { method, url: url.href, ...(Object.keys(body).length ? { body } : {}) };
  }, validateResult };
}
function changed(value) {
  if (Object.keys(value).every(key => key === "resource")) throw new ConnectorError("connector_input_invalid", "Supply at least one change.", { statusCode: 422 });
  return value;
}
const content = value => {
  if (value.templateId === undefined && !(value.subject && (value.htmlContent || value.textContent))) {
    throw new ConnectorError("connector_input_invalid", "Choose a template or provide a subject and email content.", { statusCode: 422 });
  }
  return value;
};
const contact = { attributes: bag, emailBlacklisted: bool, smsBlacklisted: bool, listIds: ids };
const brevoProvider = Object.freeze({
  ...brevoDefinition, apiOrigins: ["https://api.brevo.com"],
  apiKey: { headers: (key) => ({ "api-key": key }) },
  checkOperation: "contacts.list",
  operations: {
    "email.send": operation("POST", "smtp/email", { sender: { ...mailbox, required: true },
      to: { type: "array", required: true, items: mailbox, validator: value => value.length > 0 && value.length <= 50 || "Supply 1–50 recipients." },
      subject: text, htmlContent: { ...text, maxLength: 1000000 }, textContent: { ...text, maxLength: 1000000 },
      templateId: { ...id, required: false }, params: bag, replyTo: mailbox
    }, result => typeof result?.messageId === "string", content),
    "sms.send": operation("POST", "transactionalSMS/sms", { sender: { ...text, required: true, maxLength: 15,
      validator: value => /^[A-Za-z0-9]{1,11}$/.test(value) || /^[0-9]{12,15}$/.test(value) || "Use 1–11 letters/digits or 12–15 digits for the SMS sender." },
      recipient: { type: "string", required: true, pattern: "^\\+?[0-9]{6,15}$" }, type: { type: "string", required: true, enum: ["transactional", "marketing"] },
      content: { ...text, maxLength: 10000 }, templateId: { ...id, required: false }, params: bag, unicodeEnabled: bool, organisationPrefix: text, tag: text
    }, result => Number.isInteger(result?.messageId) && typeof result.reference === "string", value => {
      if ((value.content === undefined) === (value.templateId === undefined)) throw new ConnectorError("connector_input_invalid", "Choose SMS content or a template, not both.", { statusCode: 422 }); return value;
    }),
    "contacts.get": operation("GET", "contacts/{resource}", { resource: { ...email, required: true } }, record),
    "contacts.create": operation("POST", "contacts", { email: { ...email, required: true }, ...contact,
      updateEnabled: { ...bool, defaultTo: false } }, result => empty(result) || record(result)),
    "contacts.update": operation("PUT", "contacts/{resource}", { resource: { ...email, required: true }, ...contact, unlinkListIds: ids }, empty, changed),
    "folders.list": operation("GET", "contacts/folders", page, result => Array.isArray(result?.folders)),
    "lists.list": operation("GET", "contacts/lists", page, result => Array.isArray(result?.lists)),
    "lists.create": operation("POST", "contacts/lists", { name: { ...text, required: true }, folderId: id }, record),
    "lists.addContacts": operation("POST", "contacts/lists/{resource}/contacts/add", { resource: id, emails: { ...emails, required: true } }, result => result?.contacts !== null && typeof result?.contacts === "object"),
    "lists.removeContacts": operation("POST", "contacts/lists/{resource}/contacts/remove", { resource: id, emails: { ...emails, required: true } }, result => result?.contacts !== null && typeof result?.contacts === "object"),
    "senders.list": operation("GET", "senders", {}, result => Array.isArray(result?.senders)),
    "senders.create": operation("POST", "senders", { email: { ...email, required: true }, name: { ...text, required: true } }, record),
    "domains.create": operation("POST", "senders/domains", { name: domain }, result => typeof result?.domain_name === "string" && typeof result.message === "string"),
    "domains.get": operation("GET", "senders/domains/{resource}", { resource: domain }, result => typeof result?.domain === "string" && typeof result.verified === "boolean" && typeof result.authenticated === "boolean" && result.dns_records !== null && typeof result.dns_records === "object"),
    "domains.authenticate": operation("PUT", "senders/domains/{resource}/authenticate", { resource: domain }, result => typeof result?.domain_name === "string" && typeof result.message === "string"),
    "campaigns.list": operation("GET", "emailCampaigns", page, result => Array.isArray(result?.campaigns)),
    "campaigns.get": operation("GET", "emailCampaigns/{resource}", { resource: id }, record),
    "campaigns.create": operation("POST", "emailCampaigns", { name: { ...text, required: true }, sender: { ...mailbox, required: true },
      subject: text, htmlContent: { ...text, maxLength: 1000000 }, templateId: { ...id, required: false }, params: bag,
      recipients: { type: "object", required: true, schema: createSchema({ listIds: { ...ids, required: true,
        validator: value => value.length > 0 && value.length <= 100 || "Choose 1–100 recipient lists." }, exclusionListIds: ids }) },
      replyTo: email, previewText: text, tag: text
    }, record, content),
    "campaigns.sendTest": operation("POST", "emailCampaigns/{resource}/sendTest", { resource: id, emailTo: { ...emails, required: true } }, empty),
    "campaigns.sendNow": operation("POST", "emailCampaigns/{resource}/sendNow", { resource: id }, empty),
    "email.events": operation("GET", "smtp/statistics/events", { ...page, messageId: text, email, days: { type: "integer", min: 1, max: 90 },
      event: { type: "string", enum: ["blocked", "bounces", "deferred", "delivered", "hardBounces", "invalid", "opened", "requests", "softBounces", "spam", "unsubscribed", "clicks", "error", "loadedByProxy"] }
    }, result => Array.isArray(result?.events)),
    "sms.events": operation("GET", "transactionalSMS/statistics/events", { ...page, phoneNumber: text, days: { type: "integer", min: 1, max: 90 } }, result => Array.isArray(result?.events)),
    "events.create": operation("POST", "events", { event_name: { type: "string", required: true, maxLength: 255, pattern: "^[A-Za-z0-9_-]+$" },
      identifiers: { type: "object", required: true, schema: createSchema({ email_id: { ...email, required: true } }) },
      event_properties: { ...bag, validator: value => Buffer.byteLength(JSON.stringify(value)) <= 50000 || "Event properties exceed 50KB." }, contact_properties: bag,
      event_date: { ...text, validator: value => Number.isFinite(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value) || "Use an ISO timestamp." }
    }, empty),
    "contacts.list": jsonOperation("https://api.brevo.com/v3/contacts", {
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 50 },
      offset: { type: "integer", min: 0, defaultTo: 0 },
      sort: { type: "string", enum: ["asc", "desc"], defaultTo: "desc" }
    }, (result) => Array.isArray(result?.contacts) && Number.isInteger(result.count))
  }
});
export { brevoProvider };
