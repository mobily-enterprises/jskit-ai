import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { zohoCrmDefinition, zohoCrmRegions } from "../shared/zoho-crm.js";
import { jsonOperation } from "./jsonOperation.js";
import { zohoAuthorizationParameters, zohoOAuthMetadata, normalizeZohoTokenResponse } from "./zohoOAuth.js";

const regionFor = ({ region = "us" } = {}) => zohoCrmRegions.find(({ value }) => value === region);
const apiOrigin = (settings = {}) => `https://${settings.environment === "sandbox" ? "sandbox" : settings.environment === "developer" ? "developer" : "www"}.zohoapis.${regionFor(settings).suffix}`;
const identifier = (value) => typeof value === "string" && /^[1-9][0-9]{0,29}$/u.test(value);
const pageToken = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\s\p{Cc}]/u.test(value);

function recordsList(module, defaults) {
  const schema = createSchema({
    fields: { type: "string", defaultTo: defaults, validator: (value) => {
      const fields = value.split(",");
      return fields.length <= 50 && new Set(fields).size === fields.length && fields.every((field) => /^[A-Za-z_][A-Za-z0-9_]{0,99}$/u.test(field)) || "Use up to 50 distinct field API names, separated by commas.";
    } },
    page: { type: "integer", min: 1, max: 10 },
    per_page: { type: "integer", min: 1, max: 200, defaultTo: 100 },
    page_token: { type: "string", validator: (value) => pageToken(value) || "Use the page token returned for this user and query." }
  });
  return {
    scopes: [`ZohoCRM.modules.${module.toLowerCase()}.READ`, `ZohoCRM.modules.${module.toLowerCase()}.ALL`, "ZohoCRM.modules.READ", "ZohoCRM.modules.ALL"],
    request(input, settings) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (values.page !== undefined && values.page_token !== undefined) {
        throw new ConnectorError("connector_input_invalid", "Use either a page number or a page token.", { statusCode: 422 });
      }
      if (!values.page_token && values.page === undefined) values.page = 1;
      const url = new URL(`${apiOrigin(settings)}/crm/v8/${module}`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
      return { method: "GET", url: url.href };
    },
    validateResult: (result) => Array.isArray(result?.data) && result.data.length <= 200 && result.data.every((record) => identifier(record?.id)) &&
      Number.isSafeInteger(result.info?.count) && result.info.count === result.data.length &&
      Number.isSafeInteger(result.info.per_page) && result.info.per_page >= 1 && result.info.per_page <= 200 &&
      typeof result.info.more_records === "boolean" &&
      (result.info.page === undefined || Number.isSafeInteger(result.info.page) && result.info.page >= 1) &&
      (result.info.next_page_token == null || pageToken(result.info.next_page_token)) &&
      (result.info.previous_page_token == null || pageToken(result.info.previous_page_token))
  };
}

const zohoCrmProvider = Object.freeze({
  ...zohoCrmDefinition,
  oauth: (settings) => zohoOAuthMetadata(regionFor(settings).accounts),
  authorizationParameters: zohoAuthorizationParameters, scopeSeparator: ",",
  apiOrigins: (settings) => [apiOrigin(settings)], checkOperation: "users.current",
  normalizeTokenResponse: (response, { settings }) => normalizeZohoTokenResponse(response, apiOrigin(settings)),
  operations: {
    "users.current": {
      ...jsonOperation((settings) => `${apiOrigin(settings)}/crm/v8/users?type=CurrentUser`, {},
        (value) => Array.isArray(value?.users) && value.users.length === 1 && identifier(value.users[0]?.id)),
      scopes: ["ZohoCRM.users.READ", "ZohoCRM.users.ALL"]
    },
    "leads.list": recordsList("Leads", "Last_Name,Email"),
    "contacts.list": recordsList("Contacts", "Last_Name,Email"),
    "accounts.list": recordsList("Accounts", "Account_Name"),
    "deals.list": recordsList("Deals", "Deal_Name,Stage")
  },
  async exchange(address, options, { fetchImpl }) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", headers.get("Authorization").replace(/^Bearer /u, "Zoho-oauthtoken "));
    const response = await fetchImpl(address, { ...options, headers, credentials: "omit" });
    const url = new URL(address);
    const list = !url.pathname.endsWith("/users");
    const perPage = Number(url.searchParams.get("per_page"));
    if (response.status === 204 && list) return { data: [], info: { count: 0, per_page: perPage, more_records: false } };
    let value;
    try { value = await response.json(); } catch { /* checked after status mapping */ }
    if (value?.code === "OAUTH_SCOPE_MISMATCH") throw new ConnectorError("connector_scope_missing", "Connect again with the CRM permissions needed for this operation.", { statusCode: 403 });
    if (!response.ok) {
      if (response.status === 404) throw new ConnectorError("connector_resource_not_found", "This CRM resource is not available.", { statusCode: 404 });
      // The shared runtime maps HTTP status without exposing provider response text.
      throw Object.assign(new Error("Zoho CRM request failed."), { status: response.status });
    }
    if (response.status !== 200 || !value || value.status === "error" || value.code) {
      throw new ConnectorError("connector_response_invalid", "Zoho CRM returned an unexpected response.", { statusCode: 502 });
    }
    if (list && (value.data?.length > perPage || value.info?.per_page !== perPage ||
      url.searchParams.has("page") && value.info?.page !== Number(url.searchParams.get("page")))) {
      throw new ConnectorError("connector_response_invalid", "Zoho CRM returned an unexpected page.", { statusCode: 502 });
    }
    return value;
  }
});

export { zohoCrmProvider };
