import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { googleAdsSearchOperations } from "./google-ads-search.js";
import { googleAdsDefinition } from "../shared/google-ads.js";
import { googleProvider, googleRead } from "./google.js";

const origin = "https://googleads.googleapis.com";
const api = `${origin}/v25`;
const scope = "https://www.googleapis.com/auth/adwords";
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const customerId = { type: "string", required: true, noTrim: true, minLength: 10, maxLength: 10,
  validator: (value) => /^[0-9]{10}$/u.test(value) || "Use a 10-digit customer ID without hyphens." };
const pageToken = { type: "string", minLength: 1, maxLength: 4096, noTrim: true,
  validator: (value) => !/[\p{Cc}]/u.test(value) || "Use the returned page token without control characters." };
const searchSchema = createSchema({ customerId, pageToken,
  query: { type: "string", required: true, minLength: 1, maxLength: 16000, noTrim: true,
    validator: (value) => /^SELECT\s/iu.test(value) && !/[\p{Cc}]/u.test(value) && new TextEncoder().encode(value).length <= 32000 || "Use a single-line GAQL SELECT query of at most 32,000 UTF-8 bytes." }
});
const clientsSchema = createSchema({ customerId, pageToken });

function searchRequest(schema, input, settings, fixedQuery) {
  const { customerId: id, ...body } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
  return { method: "POST", url: `${api}/customers/${id}/googleAds:search`,
    headers: settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {},
    body: fixedQuery ? { ...body, query: fixedQuery } : body };
}

function searchResult(value) {
  return record(value) && !value.error &&
    (value.results === undefined || Array.isArray(value.results) && value.results.length <= 10000 && value.results.every(record)) &&
    (value.nextPageToken === undefined || typeof value.nextPageToken === "string" && value.nextPageToken.length <= 4096 && !/[\p{Cc}]/u.test(value.nextPageToken)) &&
    (value.fieldMask === undefined || typeof value.fieldMask === "string") &&
    (value.totalResultsCount === undefined || typeof value.totalResultsCount === "string" && /^[0-9]+$/u.test(value.totalResultsCount));
}

const googleAdsProvider = Object.freeze({
  ...googleProvider(googleAdsDefinition, origin, "customers.listAccessible", {
    ...googleAdsSearchOperations,
    "customers.listAccessible": googleRead([scope], {}, () => ({ url: `${api}/customers:listAccessibleCustomers` }),
      (value) => record(value) && !value.error && (value.resourceNames === undefined || Array.isArray(value.resourceNames) &&
        value.resourceNames.every((name) => typeof name === "string" && /^customers\/[0-9]{10}$/u.test(name)))),
    "reports.search": { scopes: [scope], request: (input, settings) => searchRequest(searchSchema, input, settings), validateResult: searchResult },
    "customers.listClients": { scopes: [scope], request: (input, settings) => searchRequest(clientsSchema, input, settings,
      "SELECT customer_client.client_customer, customer_client.level, customer_client.manager, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.id, customer_client.status FROM customer_client"), validateResult: searchResult }
  }),
  async exchange(url, options, { fetchImpl }) {
    const headers = new Headers(options.headers);
    options.signal.throwIfAborted();
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await fetchImpl(url, { ...options, headers, credentials: "omit",
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
    let value;
    try { value = await response.json(); } catch { /* handled below */ }
    if (!response.ok || value?.error) {
      const details = Array.isArray(value?.error?.details) ? value.error.details : [];
      const errors = details.flatMap((detail) => Array.isArray(detail?.errors) ? detail.errors : []);
      const codes = errors.flatMap((error) => record(error?.errorCode) ? Object.values(error.errorCode) : []);
      if (response.status === 429 || value?.error?.status === "RESOURCE_EXHAUSTED" || errors.some((error) => error?.errorCode?.quotaError)) {
        throw new ConnectorError("connector_rate_limited", "Google Ads API capacity is exhausted. Check the Cloud project and account quotas.", { statusCode: 429 });
      }
      if (details.some((detail) => detail?.reason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
        throw new ConnectorError("connector_scope_missing", "Connect Google Ads again with its required permission.", { statusCode: 403 });
      }
      if (codes.some((code) => ["CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION"].includes(code))) {
        throw new ConnectorError("connector_api_access_invalid", "Check Google Ads API access approval for the Cloud project that owns this OAuth client.", { statusCode: 403 });
      }
      if (codes.some((code) => ["OAUTH_TOKEN_INVALID", "OAUTH_TOKEN_EXPIRED", "OAUTH_TOKEN_REVOKED"].includes(code))) {
        throw new ConnectorError("connector_reconnect_required", "Connect this Google Ads account again.", { statusCode: 401 });
      }
      if (response.status === 400) throw new ConnectorError("connector_input_invalid", "Google Ads rejected the operation. Check campaign fields, policy requirements and account permissions.", { statusCode: 422 });
      if (response.status === 404) throw new ConnectorError("connector_resource_not_found", "This Google Ads resource is unavailable.", { statusCode: 404 });
      throw Object.assign(new Error("Google Ads request failed."), { status: response.ok ? 502 : response.status });
    }
    if (response.status !== 200 || !record(value)) throw new ConnectorError("connector_response_invalid", "Google Ads returned an unexpected response.", { statusCode: 502 });
    return value;
  }
});

export { googleAdsProvider };
