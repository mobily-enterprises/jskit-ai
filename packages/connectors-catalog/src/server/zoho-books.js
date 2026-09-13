import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { zohoBooksDefinition, zohoBooksIdentifier, zohoBooksOrganizationField } from "../shared/zoho-books.js";
import { zohoRegions } from "../shared/zoho-regions.js";
import { jsonOperation } from "./jsonOperation.js";
import { zohoAuthorizationParameters, zohoOAuthMetadata, normalizeZohoTokenResponse } from "./zohoOAuth.js";

const regionFor = ({ region = "eu" } = {}) => zohoRegions.find(({ value }) => value === region);
const apiOrigin = (settings) => `https://www.zohoapis.${regionFor(settings).suffix}`;
const validOrganizations = (value) => Array.isArray(value?.organizations) && value.organizations.every((org) =>
  zohoBooksIdentifier(org?.organization_id) && typeof org.name === "string" && typeof org.is_org_active === "boolean");

function booksList(resource, identifier) {
  const schema = createSchema({
    organization_id: zohoBooksOrganizationField,
    page: { type: "integer", min: 1, max: 1_000_000, defaultTo: 1 },
    per_page: { type: "integer", min: 1, max: 200, defaultTo: 100 }
  });
  return {
    scopes: [`ZohoBooks.${resource}.READ`, `ZohoBooks.${resource}.ALL`],
    request(input, settings = {}) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      if (settings.organizationId && values.organization_id && values.organization_id !== settings.organizationId) {
        throw new ConnectorError("connector_input_invalid", "This integration is configured for a different organisation.", { statusCode: 422 });
      }
      values.organization_id = settings.organizationId || values.organization_id;
      if (!values.organization_id) {
        throw new ConnectorError("connector_input_invalid", "Choose an organisation ID from organizations.list or configure one for this integration.", { statusCode: 422 });
      }
      const url = new URL(`${apiOrigin(settings)}/books/v3/${resource}`);
      for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
      return { method: "GET", url: url.href };
    },
    validateResult: (value) => Array.isArray(value?.[resource]) && value[resource].length <= 200 &&
      value[resource].every((record) => zohoBooksIdentifier(record?.[identifier])) && typeof value.page_context?.has_more_page === "boolean"
  };
}

const zohoBooksProvider = Object.freeze({
  ...zohoBooksDefinition,
  oauth: (settings) => zohoOAuthMetadata(regionFor(settings).accounts),
  authorizationParameters: zohoAuthorizationParameters, scopeSeparator: ",",
  apiOrigins: (settings) => [apiOrigin(settings)], checkOperation: "organizations.list",
  normalizeTokenResponse: (response, { settings }) => normalizeZohoTokenResponse(response, apiOrigin(settings)),
  operations: {
    "organizations.list": {
      ...jsonOperation((settings) => `${apiOrigin(settings)}/books/v3/organizations`, {}, validOrganizations),
      scopes: ["ZohoBooks.settings.READ"]
    },
    "contacts.list": booksList("contacts", "contact_id"),
    "invoices.list": booksList("invoices", "invoice_id")
  },
  async exchange(address, options, { fetchImpl, settings }) {
    const headers = new Headers(options.headers);
    headers.set("Authorization", headers.get("Authorization").replace(/^Bearer /u, "Zoho-oauthtoken "));
    const response = await fetchImpl(address, { ...options, headers, credentials: "omit" });
    if (!response.ok) {
      if (response.status === 404) throw new ConnectorError("connector_resource_not_found", "This Books resource is not available.", { statusCode: 404 });
      throw Object.assign(new Error("Zoho Books request failed."), { status: response.status });
    }
    let value;
    try { value = await response.json(); } catch { /* validated below */ }
    if (response.status !== 200 || value?.code !== 0) {
      throw new ConnectorError("connector_response_invalid", "Zoho Books returned an unexpected response.", { statusCode: 502 });
    }
    const url = new URL(address);
    if (url.pathname.endsWith("/organizations")) {
      if (!validOrganizations(value)) throw new ConnectorError("connector_response_invalid", "Zoho Books returned invalid organisations.", { statusCode: 502 });
      if (settings.organizationId && !value.organizations.some((org) => org.organization_id === settings.organizationId && org.is_org_active)) {
        throw new ConnectorError("connector_permission_denied", "The configured Books organisation is not active and accessible to this account.", { statusCode: 403 });
      }
    } else {
      const resource = url.pathname.split("/").at(-1);
      // Books documents invoice page_context as a singleton array; other lists use an object.
      if (resource === "invoices" && Array.isArray(value.page_context)) {
        if (value.page_context.length !== 1) throw new ConnectorError("connector_response_invalid", "Zoho Books returned ambiguous pagination.", { statusCode: 502 });
        value.page_context = value.page_context[0];
      }
      if (value[resource]?.length > Number(url.searchParams.get("per_page")) ||
        value.page_context?.per_page !== Number(url.searchParams.get("per_page")) ||
        value.page_context?.page !== Number(url.searchParams.get("page"))) {
        throw new ConnectorError("connector_response_invalid", "Zoho Books returned an unexpected page.", { statusCode: 502 });
      }
    }
    return value;
  }
});

export { zohoBooksProvider };
