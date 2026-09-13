import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { lexwareDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const id = { type: "string", required: true, validator: value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value) || "Use a Lexware resource UUID." };
const text = { type: "string", minLength: 1, maxLength: 1000 };
const date = { type: "string", required: true, validator: value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().startsWith(value.slice(0, 10)) || "Use an ISO timestamp with timezone." };
const paging = { page: { type: "integer", min: 0, max: 100000, defaultTo: 0 }, size: { type: "integer", min: 1, max: 250, defaultTo: 25 } };
const pageResult = result => Array.isArray(result?.content) && typeof result.first === "boolean" && typeof result.last === "boolean" &&
  ["totalPages", "totalElements", "numberOfElements", "number"].every(field => Number.isInteger(result[field]) && result[field] >= 0) && Number.isInteger(result.size) && result.size > 0;
const resourceResult = result => typeof result?.id === "string";
function operation(fields, build, validateResult = resourceResult) {
  const schema = createSchema(fields);
  return { scopes: [], request(input) { return build(validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 })); }, validateResult };
}
const line = createSchema({
  name: { ...text, required: true }, description: { ...text, maxLength: 5000 },
  quantity: { type: "number", required: true, min: 0.000001, max: 1000000 },
  unitName: { ...text, required: true, maxLength: 100 },
  netAmount: { type: "number", required: true, min: 0, max: 1000000000 },
  taxRatePercentage: { type: "number", required: true, min: 0, max: 100 }
});
const lexwareProvider = Object.freeze({
  ...lexwareDefinition,
  apiOrigins: ["https://api.lexware.io"],
  apiKey: { headers: key => ({ Authorization: `Bearer ${key}` }) },
  checkOperation: "contacts.list",
  operations: {
    "contacts.list": jsonOperation("https://api.lexware.io/v1/contacts", {
      ...paging, customer: { type: "boolean" }, vendor: { type: "boolean" }
    }, pageResult),
    ...Object.fromEntries(["contacts", "articles", "invoices", "vouchers"].map(resource => [
      `${resource}.get`, operation({ id }, ({ id }) => ({ method: "GET", url: `https://api.lexware.io/v1/${resource}/${id}` }))
    ])),
    "articles.list": jsonOperation("https://api.lexware.io/v1/articles", {
      ...paging, articleNumber: text, gtin: text, type: { type: "string", enum: ["PRODUCT", "SERVICE"] }
    }, pageResult),
    "vouchers.list": jsonOperation("https://api.lexware.io/v1/voucherlist", {
      ...paging,
      voucherType: { type: "string", required: true, enum: ["any", "invoice", "salesinvoice", "salescreditnote", "purchaseinvoice", "purchasecreditnote"] },
      voucherStatus: { type: "string", required: true, enum: ["any", "draft", "open", "overdue", "paid", "paidoff", "voided", "transferred", "sepadebit", "unchecked"] },
      contactId: { ...id, required: false }, archived: { type: "boolean" }
    }, pageResult),
    "invoices.createDraft": operation({
      contactId: id, voucherDate: date, shippingDate: date,
      shippingType: { type: "string", required: true, enum: ["service", "delivery"] },
      lineItems: { type: "array", required: true, validator: value => value.length > 0 && value.length <= 100 || "Use 1–100 invoice lines.",
        items: { type: "object", schema: line } },
      title: text, introduction: { ...text, maxLength: 5000 }, remark: { ...text, maxLength: 5000 }
    }, ({ contactId, voucherDate, shippingDate, shippingType, lineItems, ...other }) => ({
      method: "POST", url: "https://api.lexware.io/v1/invoices?finalize=false",
      body: { ...other, voucherDate, address: { contactId },
        lineItems: lineItems.map(({ netAmount, taxRatePercentage, ...item }) => ({ ...item, type: "custom", unitPrice: { currency: "EUR", netAmount, taxRatePercentage } })),
        totalPrice: { currency: "EUR" }, taxConditions: { taxType: "net" }, shippingConditions: { shippingDate, shippingType } }
    }))
  }
});
export { lexwareProvider };
