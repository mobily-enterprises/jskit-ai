import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { chargebeeDefinition } from "../shared/chargebee.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = ({ siteName }) => `https://${siteName.toLowerCase()}.chargebee.com`;
const text = { type: "string", minLength: 1, maxLength: 250 };
const resource = { ...text, required: true, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" };
const pagination = { limit: { type: "integer", min: 1, max: 100, defaultTo: 20 }, offset: { ...text, maxLength: 1000 } };
const itemList = { type: "array", required: true, items: { type: "object", schema: createSchema({
  item_price_id: { ...resource }, quantity: { type: "integer", min: 1, required: true }
}) }, validator: values => values.length > 0 && values.length <= 100 || "Choose between 1 and 100 item prices." };
const customerFields = { email: { ...text, pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" }, first_name: text, last_name: text, company: text };
const returnUrl = { ...text, required: true, validator: value => {
  try { const u = new URL(value); return !u.username && !u.password && (u.protocol === "https:" || u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) || "Use an HTTPS or localhost return URL."; }
  catch { return "Use an absolute return URL."; }
} };
const record = key => result => typeof result?.[key]?.id === "string" && result[key].id.length > 0;
const collection = key => result => Array.isArray(result?.list) && result.list.every(entry => record(key)(entry)) &&
  (result.next_offset === undefined || typeof result.next_offset === "string");
function operation(method, endpoint, fields, validateResult, defaults = {}) {
  const schema = createSchema({ ...fields, ...(method === "POST" ? { idempotencyKey: { ...resource } } : {}) });
  return { scopes: [], request(input, settings) {
    const { resource: id, idempotencyKey, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...values, ...defaults })) {
      if (Array.isArray(value)) value.forEach((entry, index) => { for (const [field, child] of Object.entries(entry)) body.set(`${key}[${field}][${index}]`, String(child)); });
      else if (value && typeof value === "object") { for (const [field, child] of Object.entries(value)) body.set(`${key}[${field}]`, String(child)); }
      else body.set(key, String(value));
    }
    const url = new URL(`${origin(settings)}/api/v2/${endpoint.replace("{resource}", id || "")}`);
    if (method === "GET") { url.search = body.toString(); return { method, url: url.href }; }
    return { method, url: url.href, body: body.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "chargebee-idempotency-key": idempotencyKey } };
  }, validateResult };
}
const chargebeeProvider = Object.freeze({
  ...chargebeeDefinition,
  apiOrigins: (settings) => [origin(settings)],
  apiKey: { headers: (key) => {
    if (/[:\s\p{Cc}]/u.test(key)) {
      throw new ConnectorError("connector_binding_missing", "Use the Chargebee API key without spaces, control characters or colons.");
    }
    return { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` };
  } },
  checkOperation: "customers.list",
  operations: {
    "customers.get": operation("GET", "customers/{resource}", { resource }, record("customer")),
    "customers.create": operation("POST", "customers", { ...customerFields, email: { ...customerFields.email, required: true }, id: { ...resource, required: false } }, record("customer")),
    "customers.update": operation("POST", "customers/{resource}", { resource, ...customerFields }, record("customer")),
    "itemFamilies.list": operation("GET", "item_families", pagination, collection("item_family")),
    "items.list": operation("GET", "items", pagination, collection("item")),
    "items.get": operation("GET", "items/{resource}", { resource }, record("item")),
    "itemPrices.list": operation("GET", "item_prices", pagination, collection("item_price")),
    "itemPrices.get": operation("GET", "item_prices/{resource}", { resource }, record("item_price")),
    "subscriptions.list": operation("GET", "subscriptions", { ...pagination, "customer_id[is]": text }, collection("subscription")),
    "subscriptions.get": operation("GET", "subscriptions/{resource}", { resource }, record("subscription")),
    "subscriptions.create": operation("POST", "customers/{resource}/subscription_for_items", { resource, subscription_items: itemList,
      auto_collection: { type: "string", required: true, enum: ["on", "off"] }, invoice_immediately: { type: "boolean", required: true },
      id: { ...resource, required: false }, trial_end: { type: "integer", min: 0 }
    }, record("subscription")),
    "subscriptions.updateAtTermEnd": operation("POST", "subscriptions/{resource}/update_for_items", { resource, subscription_items: itemList,
      replace_items_list: { type: "boolean", required: true }
    }, record("subscription"), { end_of_term: true }),
    "subscriptions.cancelAtTermEnd": operation("POST", "subscriptions/{resource}/cancel_for_items", { resource, cancel_reason_code: text }, record("subscription"), { cancel_option: "end_of_term" }),
    "invoices.list": operation("GET", "invoices", { ...pagination, "customer_id[is]": text, "subscription_id[is]": text }, collection("invoice")),
    "invoices.get": operation("GET", "invoices/{resource}", { resource, line_items_limit: { type: "integer", min: 1, max: 300 }, line_items_offset: { ...text, maxLength: 1000 } }, record("invoice")),
    "invoices.pdf": operation("POST", "invoices/{resource}/pdf", { resource, disposition_type: { type: "string", enum: ["inline", "attachment"], defaultTo: "attachment" } }, result => typeof result?.download?.download_url === "string"),
    "hostedPages.checkoutNew": operation("POST", "hosted_pages/checkout_new_for_items", { subscription_items: itemList,
      customer: { type: "object", required: true, schema: createSchema({ id: { ...resource } }) }, redirect_url: returnUrl, cancel_url: returnUrl
    }, record("hosted_page")),
    "hostedPages.checkoutExisting": operation("POST", "hosted_pages/checkout_existing_for_items", { subscription_items: itemList,
      subscription: { type: "object", required: true, schema: createSchema({ id: { ...resource } }) }, redirect_url: returnUrl, cancel_url: returnUrl
    }, record("hosted_page")),
    "hostedPages.get": operation("GET", "hosted_pages/{resource}", { resource }, record("hosted_page")),
    "portalSessions.create": operation("POST", "portal_sessions", { customer: { type: "object", required: true, schema: createSchema({ id: { ...resource } }) }, redirect_url: returnUrl }, record("portal_session")),
    "events.list": operation("GET", "events", pagination, collection("event")),
    "events.get": operation("GET", "events/{resource}", { resource }, record("event")),
    "customers.list": jsonOperation((settings) => `${origin(settings)}/api/v2/customers`, {
      limit: { type: "integer", min: 1, max: 100, defaultTo: 10 },
      offset: { type: "string", minLength: 1, maxLength: 1000 },
      include_deleted: { type: "boolean", defaultTo: false }
    }, (result) => Array.isArray(result?.list) && result.list.every((entry) =>
      entry?.customer && typeof entry.customer.id === "string" && entry.customer.id.length > 0) &&
      (result.next_offset === undefined || typeof result.next_offset === "string" && result.next_offset.length > 0 && result.next_offset.length <= 1000))
  }
});
export { chargebeeProvider };
