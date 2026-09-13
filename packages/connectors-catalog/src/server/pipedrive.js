import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { pipedriveDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";
import { ConnectorError } from "@jskit-ai/connectors-core/server";

function companyApiDomain(value) {
  if (typeof value !== "string" || !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pipedrive\.com$/.test(value)) {
    throw new ConnectorError("connector_response_invalid", "Pipedrive returned an invalid company API address.", { statusCode: 502 });
  }
  return value;
}

const numberId = { type: "integer", min: 1 };
const text = { type: "string", minLength: 1, maxLength: 1000 };
const contactValues = { type: "array", validator: values => values.length <= 20 || "Use at most 20 contact values.",
  items: { type: "object", schema: createSchema({ value: { ...text, required: true }, primary: { type: "boolean" }, label: text }) } };
const recordFields = {
  deals: { title: text, person_id: numberId, org_id: numberId, owner_id: numberId, stage_id: numberId,
    value: { type: "number", min: 0 }, currency: { type: "string", pattern: "^[A-Z]{3}$" }, status: { type: "string", enum: ["open", "won", "lost"] } },
  persons: { name: text, org_id: numberId, owner_id: numberId, emails: contactValues, phones: contactValues },
  organizations: { name: text, owner_id: numberId },
  activities: { subject: text, type: text, person_id: numberId, org_id: numberId, deal_id: numberId,
    done: { type: "boolean" }, due_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, due_time: { type: "string", pattern: "^\\d{2}:\\d{2}$" } },
  leads: { title: text, person_id: numberId, organization_id: numberId, owner_id: numberId }
};
function crmOperation(collection, action) {
  const lead = collection === "leads", write = ["create", "update"].includes(action);
  const id = lead ? { type: "string", pattern: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$" } : numberId;
  const primary = ["deals", "leads"].includes(collection) ? "title" : collection === "activities" ? "subject" : "name";
  const fields = write ? { ...recordFields[collection], ...(action === "create" ? { [primary]: { ...text, required: true } } : {}) } : action === "list"
    ? { limit: { type: "integer", min: 1, max: 500, defaultTo: 100 }, ...(lead ? { start: { type: "integer", min: 0 } } : { cursor: { type: "string", minLength: 1, maxLength: 4096 } }) } : {};
  const schema = createSchema({ ...fields, ...(["get", "update"].includes(action) ? { id: { ...id, required: true } } : {}) });
  return { scopes: [], request(input, settings = {}, data) {
    const { id, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    if (action === "update" && !Object.keys(values).length || lead && action === "create" && !values.person_id && !values.organization_id)
      throw new ConnectorError("connector_input_invalid", "Supply changed fields; a new lead also needs a person or organization.", { statusCode: 422 });
    if (!data && !settings.companyDomain) throw new ConnectorError("connector_binding_missing", "Set the Pipedrive Company domain for API-token CRM operations.", { statusCode: 422 });
    const origin = data ? companyApiDomain(data.apiDomain) : companyApiDomain(`https://${settings.companyDomain}.pipedrive.com`);
    const url = new URL(`${origin}/api/${lead ? "v1" : "v2"}/${collection}${id === undefined ? "" : `/${id}`}`);
    if (!write) for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
    return { method: action === "create" ? "POST" : action === "update" ? "PATCH" : "GET", url: url.href, ...(write ? { body: values } : {}) };
  }, validateResult: result => result?.success === true && (action === "list" ? Array.isArray(result.data)
    : lead ? typeof result.data?.id === "string" : Number.isInteger(result.data?.id)) };
}

const profile = jsonOperation("https://api.pipedrive.com/v1/users/me", {},
  (result) => result?.success === true && Number.isInteger(result.data?.id));

const pipedriveProvider = Object.freeze({
  ...pipedriveDefinition,
  oauth: { issuer: "https://oauth.pipedrive.com", authorization_endpoint: "https://oauth.pipedrive.com/oauth/authorize",
    token_endpoint: "https://oauth.pipedrive.com/oauth/token" },
  oauthPkce: false,
  oauthBasicEncoding: "raw",
  dataFromTokenResponse(response, previous) {
    const apiDomain = companyApiDomain(response.api_domain);
    if (previous && apiDomain !== previous.apiDomain) {
      throw new ConnectorError("connector_reconnect_required", "The Pipedrive company address changed. Connect this account again.", { statusCode: 401 });
    }
    return { apiDomain };
  },
  apiOrigins: (settings, data) => data ? [companyApiDomain(data.apiDomain)] : ["https://api.pipedrive.com", ...(settings.companyDomain ? [companyApiDomain(`https://${settings.companyDomain}.pipedrive.com`)] : [])],
  apiKey: { headers: (key) => ({ "x-api-token": key }) },
  checkOperation: "profile.read",
  operations: {
    "deals.list": crmOperation("deals", "list"),
    "deals.get": crmOperation("deals", "get"),
    "deals.create": crmOperation("deals", "create"),
    "deals.update": crmOperation("deals", "update"),
    "persons.list": crmOperation("persons", "list"),
    "persons.get": crmOperation("persons", "get"),
    "persons.create": crmOperation("persons", "create"),
    "persons.update": crmOperation("persons", "update"),
    "organizations.list": crmOperation("organizations", "list"),
    "organizations.get": crmOperation("organizations", "get"),
    "organizations.create": crmOperation("organizations", "create"),
    "organizations.update": crmOperation("organizations", "update"),
    "activities.list": crmOperation("activities", "list"),
    "activities.get": crmOperation("activities", "get"),
    "activities.create": crmOperation("activities", "create"),
    "activities.update": crmOperation("activities", "update"),
    "leads.list": crmOperation("leads", "list"),
    "leads.get": crmOperation("leads", "get"),
    "leads.create": crmOperation("leads", "create"),
    "leads.update": crmOperation("leads", "update"),
    "pipelines.list": crmOperation("pipelines", "list"),
    "pipelines.get": crmOperation("pipelines", "get"),
    "profile.read": { ...profile, request(input, settings, data) {
      const request = profile.request(input, settings);
      return { ...request, url: data ? `${companyApiDomain(data.apiDomain)}/api/v1/users/me` : request.url };
    } }
  }
});
export { pipedriveProvider };
