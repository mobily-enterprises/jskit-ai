import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { mailgunDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const origins = { us: "https://api.mailgun.net", eu: "https://api.eu.mailgun.net" };
const domainField = { type: "string", required: true, minLength: 3, maxLength: 253,
  pattern: "^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$" };
const domainSchema = createSchema({ domain: domainField });
const sendSchema = createSchema({
  domain: domainField,
  from: { type: "string", required: true, minLength: 3, maxLength: 320, pattern: "^[^\\r\\n]+$" },
  to: { type: "array", required: true,
    validator: value => (value.length > 0 && value.length <= 1000) || "Provide 1–1000 recipients.",
    items: { type: "string", minLength: 3, maxLength: 320, pattern: "^[^\\s@]+@[^\\s@]+$" } },
  subject: { type: "string", required: true, minLength: 1, maxLength: 998, pattern: "^[^\\r\\n]+$" },
  text: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1000000 },
  html: { type: "string", noTrim: true, minLength: 1, maxLength: 1000000 }
});
const logsSchema = createSchema({
  domain: domainField,
  duration: { type: "string", defaultTo: "1d", pattern: "^[1-9][0-9]*[dh]$", maxLength: 12 },
  limit: { type: "integer", min: 1, max: 100, defaultTo: 50 },
  token: { type: "string", minLength: 1, maxLength: 8192 },
  end: { type: "string", minLength: 1, maxLength: 100 }
});
const validDomain = result => typeof result?.domain?.name === "string" &&
  Array.isArray(result.sending_dns_records) && Array.isArray(result.receiving_dns_records);

// Domain access and sending remain separate authorized application operations.
function domainOperation(method, suffix = "") {
  return { scopes: [], request(input, settings) {
    const { domain } = validateSchemaPayload({ schema: domainSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method, url: `${origins[settings.region]}/v4/domains/${encodeURIComponent(domain)}${suffix}` };
  }, validateResult: validDomain };
}

const mailgunProvider = Object.freeze({
  ...mailgunDefinition, apiOrigins: Object.values(origins),
  apiKey: { headers: (key) => ({ Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` }) },
  checkOperation: "domains.list",
  operations: {
    "messages.send": { scopes: [], request(input, settings) {
      const { domain, to, ...fields } = validateSchemaPayload({ schema: sendSchema, mode: "replace" }, input, { statusCode: 422 });
      const body = new FormData();
      for (const [name, value] of Object.entries(fields)) body.append(name, value);
      for (const recipient of to) body.append("to", recipient);
      return { method: "POST", url: `${origins[settings.region]}/v3/${encodeURIComponent(domain)}/messages`, body };
    }, validateResult: result => typeof result?.id === "string" && result.id.length > 0 && typeof result.message === "string" },
    "domains.get": domainOperation("GET"),
    "domains.verify": domainOperation("PUT", "/verify"),
    "domains.create": { scopes: [], request(input, settings) {
      const { domain } = validateSchemaPayload({ schema: domainSchema, mode: "replace" }, input, { statusCode: 422 });
      const body = new FormData();
      body.append("name", domain);
      return { method: "POST", url: `${origins[settings.region]}/v4/domains`, body };
    }, validateResult: validDomain },
    "logs.list": { scopes: [], request(input, settings) {
      const { domain, limit, token, ...range } = validateSchemaPayload({ schema: logsSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "POST", url: `${origins[settings.region]}/v1/analytics/logs`, body: {
        ...range, include_subaccounts: false,
        filter: { AND: [{ attribute: "domain", comparator: "=", values: [{ label: domain, value: domain }] }] },
        pagination: { limit, sort: "timestamp:asc", ...(token ? { token } : {}) }
      } };
    }, validateResult: result => Array.isArray(result?.items) && !!result.pagination && typeof result.pagination === "object" },
    "domains.list": jsonOperation((settings) => `${origins[settings.region]}/v4/domains`, {
      limit: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
      skip: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
      state: { type: "string", enum: ["active", "unverified", "disabled"] },
      sort: { type: "string", enum: ["name", "name:asc", "name:desc"] },
      search: { type: "string", maxLength: 253 },
      include_subaccounts: { type: "boolean", defaultTo: false }
    }, (result) => Array.isArray(result?.items) && Number.isInteger(result.total_count) && result.total_count >= 0)
  }
});
export { mailgunProvider };
