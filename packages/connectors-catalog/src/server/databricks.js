import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { databricksDefinition } from "../shared/databricks.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = (settings) => new URL(settings.workspaceUrl).origin;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) => Number.isSafeInteger(value) && value > 0;
const pageToken = { type: "string", minLength: 1, maxLength: 8192 };
const pagination = (value) => ["next_page_token", "prev_page_token"].every((key) => value[key] === undefined ||
  typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 8192);
const job = (value) => object(value) && identifier(value.job_id) &&
  (value.settings === undefined || object(value.settings)) && (value.has_more === undefined || typeof value.has_more === "boolean");
const jobsList = jsonOperation((settings) => `${origin(settings)}/api/2.2/jobs/list`, {
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  expand_tasks: { type: "boolean", defaultTo: false }, name: { type: "string", minLength: 1, maxLength: 4096 }, page_token: pageToken
}, (value) => object(value) && pagination(value) && (value.jobs === undefined || Array.isArray(value.jobs) && value.jobs.every(job)));
const jobsGet = jsonOperation((settings) => `${origin(settings)}/api/2.2/jobs/get`, {
  job_id: { type: "integer", required: true, min: 1, max: Number.MAX_SAFE_INTEGER },
  include_trigger_state: { type: "boolean", defaultTo: false }, page_token: pageToken
}, (value) => job(value) && pagination(value));

const databricksProvider = Object.freeze({
  ...databricksDefinition,
  oauth: (settings) => ({ issuer: `${origin(settings)}/oidc`, authorization_endpoint: `${origin(settings)}/oidc/v1/authorize`,
    token_endpoint: `${origin(settings)}/oidc/v1/token` }),
  apiOrigins: (settings) => [origin(settings)], checkOperation: "jobs.list", tokenRefreshLeewayMs: 40_000,
  async normalizeTokenResponse(response) {
    if (response.ok) {
      let value;
      try { value = await response.clone().json(); } catch { /* reported below */ }
      if (!Number.isSafeInteger(value?.expires_in) || value.expires_in <= 40 ||
        (value.scope !== undefined && (typeof value.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope))) ||
        (value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || !value.refresh_token.trim()))) {
        throw new ConnectorError("connector_response_invalid", "Databricks returned an invalid token grant.", { statusCode: 502 });
      }
    }
    return response;
  },
  operations: { "jobs.list": { ...jobsList, scopes: ["all-apis", "jobs"] }, "jobs.get": { ...jobsGet, scopes: ["all-apis", "jobs"] } },
  async exchange(address, options, { fetchImpl }) {
    const url = new URL(address);
    // An empty jobs list is {}, but JSON null or an unparseable body is not a verified list.
    const response = await fetchImpl(address, { ...options, credentials: "omit" });
    if (!response.ok) throw Object.assign(new Error("Databricks request failed."), { status: response.status });
    let result;
    try { result = await response.json(); } catch { /* checked below */ }
    if (response.status !== 200 || !object(result) || result.error_code || result.error ||
      (url.pathname.endsWith("/list") && result?.jobs?.length > Number(url.searchParams.get("limit"))) ||
      (url.pathname.endsWith("/get") && result?.job_id !== Number(url.searchParams.get("job_id")))) {
      throw new ConnectorError("connector_response_invalid", "Databricks returned an unexpected job response.", { statusCode: 502 });
    }
    return result;
  }
});
export { databricksProvider };
