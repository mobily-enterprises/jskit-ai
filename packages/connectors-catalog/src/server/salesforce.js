import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { salesforceDefinition } from "../shared/salesforce.js";
import { jsonOperation } from "./jsonOperation.js";

const apiPath = "/services/data/v66.0";
const origin = (settings) => new URL(settings.accountUrl).origin;
const endpoint = (resource) => (settings) => `${origin(settings)}${apiPath}/${resource}`;
const objectName = (value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_]{0,254}$/u.test(value);
const locator = (value) => typeof value === "string" && /^\/services\/data\/v66\.0\/query\/[A-Za-z0-9]{15,18}-[0-9]{1,10}$/u.test(value);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const limits = (value) => record(value) && Number.isSafeInteger(value.DailyApiRequests?.Max) && value.DailyApiRequests.Max >= 0 &&
  Number.isSafeInteger(value.DailyApiRequests.Remaining) && value.DailyApiRequests.Remaining >= 0;
const queryResult = (value) => Number.isSafeInteger(value?.totalSize) && value.totalSize >= 0 && typeof value.done === "boolean" &&
  Array.isArray(value.records) && value.records.length <= 2000 && value.records.every(record) && value.records.length <= value.totalSize &&
  (value.done ? value.nextRecordsUrl == null : locator(value.nextRecordsUrl));
const describeSchema = createSchema({ object: { type: "string", required: true, validator: (value) => objectName(value) || "Use a Salesforce object API name." } });
const nextSchema = createSchema({ nextRecordsUrl: { type: "string", required: true, noTrim: true,
  validator: (value) => locator(value) || "Use the nextRecordsUrl returned by this connection's v66.0 query." } });

const salesforceProvider = Object.freeze({
  ...salesforceDefinition,
  oauth: (settings) => ({ issuer: origin(settings), authorization_endpoint: `${origin(settings)}/services/oauth2/authorize`, token_endpoint: `${origin(settings)}/services/oauth2/token` }),
  apiOrigins: (settings) => [origin(settings)], checkOperation: "limits.read",
  async normalizeTokenResponse(response, { settings }) {
    if (!response.ok) return response;
    let value;
    try { value = await response.clone().json(); } catch { /* reported below */ }
    if (!record(value) || ![origin(settings), origin(settings) + "/"].includes(value.instance_url) || typeof value.scope !== "string" || !value.scope.trim()) {
      throw new ConnectorError("connector_response_invalid", "Salesforce returned an invalid grant or a different organisation.", { statusCode: 502 });
    }
    // Salesforce can omit expiry. Renew after five minutes of use as a local
    // policy; this is not a claim about the org's actual session lifetime.
    return value.expires_in === undefined ? Response.json({ ...value, expires_in: 300 }) : response;
  },
  operations: {
    "limits.read": { ...jsonOperation(endpoint("limits"), {}, limits), scopes: ["api"] },
    "objects.list": { ...jsonOperation(endpoint("sobjects"), {},
      (value) => Array.isArray(value?.sobjects) && value.sobjects.every((object) => objectName(object?.name) && typeof object.label === "string" && typeof object.queryable === "boolean")), scopes: ["api"] },
    "objects.describe": {
      scopes: ["api"],
      request(input, settings) {
        const values = validateSchemaPayload({ schema: describeSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: endpoint(`sobjects/${values.object}/describe`)(settings) };
      },
      validateResult: (value) => objectName(value?.name) && Array.isArray(value.fields) && value.fields.every((field) => objectName(field?.name) && typeof field.type === "string")
    },
    "query.read": {
      ...jsonOperation(endpoint("query"), { q: { type: "string", required: true, minLength: 1, maxLength: 2000,
        validator: (value) => /^SELECT\s/iu.test(value) && new TextEncoder().encode(value).length <= 3000 && !/\bFOR\s+(?:UPDATE|VIEW|REFERENCE)\b/iu.test(value) && !/[\p{Cc}]/u.test(value) || "Use a single-line SELECT query without FOR UPDATE, FOR VIEW or FOR REFERENCE." } }, queryResult), scopes: ["api"]
    },
    "query.next": {
      scopes: ["api"],
      request(input, settings) {
        const values = validateSchemaPayload({ schema: nextSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "GET", url: origin(settings) + values.nextRecordsUrl };
      },
      validateResult: queryResult
    }
  },
  async exchange(address, options, { fetchImpl }) {
    const response = await fetchImpl(address, { ...options, credentials: "omit" });
    let value;
    try { value = await response.json(); } catch { /* checked after status */ }
    const code = Array.isArray(value) ? value[0]?.errorCode : null;
    if (!response.ok) {
      if (code === "REQUEST_LIMIT_EXCEEDED") throw new ConnectorError("connector_rate_limited", "The Salesforce organisation's API request limit was reached.", { statusCode: 429 });
      if (code === "INVALID_SESSION_ID") throw new ConnectorError("connector_reconnect_required", "Connect this Salesforce account again.", { statusCode: 401 });
      if (code === "INVALID_QUERY_LOCATOR") throw new ConnectorError("connector_cursor_expired", "Start the Salesforce query again; its result cursor is no longer valid.", { statusCode: 410 });
      if (response.status === 404) throw new ConnectorError("connector_resource_not_found", "This Salesforce resource is not available.", { statusCode: 404 });
      if (response.status === 400) throw new ConnectorError("connector_query_invalid", "Salesforce rejected the query or object. Check its API names and the user's permissions.", { statusCode: 422 });
      throw Object.assign(new Error("Salesforce request failed."), { status: response.status });
    }
    if (response.status !== 200 || !record(value)) throw new ConnectorError("connector_response_invalid", "Salesforce returned an unexpected response.", { statusCode: 502 });
    const url = new URL(address);
    if (url.pathname.endsWith("/describe") && value.name !== url.pathname.split("/").at(-2)) {
      throw new ConnectorError("connector_response_invalid", "Salesforce described a different object.", { statusCode: 502 });
    }
    return value;
  }
});

export { salesforceProvider };
