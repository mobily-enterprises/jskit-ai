import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { hubspotDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const base = "https://api.hubapi.com/crm/objects/2026-09";
const recordId = { type: "string", required: true, minLength: 1, maxLength: 100,
  validator: value => /^[0-9]+$/u.test(value) || "Use the HubSpot numeric record ID." };
const properties = { type: "object", required: true, validator: value => {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 100 && entries.every(([key, item]) =>
    /^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key) && typeof item === "string") &&
    Buffer.byteLength(JSON.stringify(value)) <= 100000 || "Provide 1–100 named string properties, within 100KB.";
} };
const readFields = {
  properties: { type: "string", maxLength: 4096, validator: value => /^[a-zA-Z0-9_,]+$/u.test(value) || "Use comma-separated property names." },
  associations: { type: "string", enum: ["contacts", "deals", "contacts,deals"] },
  archived: { type: "boolean", defaultTo: false }
};
const validRecord = value => typeof value?.id === "string" && value.properties && typeof value.properties === "object" && !Array.isArray(value.properties);
function objectOperations(object) {
  const readScope = `crm.objects.${object}.read`, writeScope = `crm.objects.${object}.write`;
  const read = createSchema({ id: recordId, ...readFields });
  const write = createSchema({ id: recordId, properties });
  const create = createSchema({ properties });
  return {
    [`${object}.list`]: { ...jsonOperation(`${base}/${object}`, {
      limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
      after: { type: "string", maxLength: 4096 }, ...readFields
    }, value => Array.isArray(value?.results)), scopes: [readScope] },
    [`${object}.get`]: { scopes: [readScope], request(input) {
      const { id, ...query } = validateSchemaPayload({ schema: read, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${base}/${object}/${encodeURIComponent(id)}`);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
      return { method: "GET", url: url.href };
    }, validateResult: validRecord },
    [`${object}.create`]: { scopes: [writeScope], request(input) {
      const body = validateSchemaPayload({ schema: create, mode: "replace" }, input, { statusCode: 422 });
      if (object === "contacts" ? !["email", "firstname", "lastname"].some(key => body.properties[key]?.trim()) :
        !body.properties.dealname?.trim() || !body.properties.dealstage?.trim()) {
        throw new ConnectorError("connector_input_invalid", object === "contacts" ? "Supply email, firstname or lastname." : "Supply dealname and the internal dealstage ID.", { statusCode: 422 });
      }
      return { method: "POST", url: `${base}/${object}`, body };
    }, validateResult: validRecord },
    [`${object}.update`]: { scopes: [writeScope], request(input) {
      const { id, ...body } = validateSchemaPayload({ schema: write, mode: "replace" }, input, { statusCode: 422 });
      return { method: "PATCH", url: `${base}/${object}/${encodeURIComponent(id)}`, body };
    }, validateResult: validRecord }
  };
}
const associationSchema = createSchema({ contactId: recordId, dealId: recordId });

const hubspotProvider = Object.freeze({
  ...hubspotDefinition, apiOrigins: ["https://api.hubapi.com"],
  apiKey: { headers: (key) => ({ Authorization: `Bearer ${key}` }) },
  oauth: {
    issuer: "https://api.hubspot.com",
    authorization_endpoint: "https://app.hubspot.com/oauth/authorize",
    token_endpoint: "https://api.hubspot.com/oauth/2026-09/token"
  },
  // HubSpot documents confidential-client code grants without PKCE.
  oauthPkce: false,
  async normalizeTokenResponse(response) {
    if (!response.ok) return response;
    let value;
    try { value = await response.clone().json(); } catch {
      throw new ConnectorError("connector_response_invalid", "HubSpot returned an invalid token response.", { statusCode: 502 });
    }
    if (!Array.isArray(value?.scopes) || !value.scopes.every((scope) => typeof scope === "string" && /^[^\s]+$/u.test(scope))) {
      throw new ConnectorError("connector_response_invalid", "HubSpot returned an invalid permission grant.", { statusCode: 502 });
    }
    return Response.json({ ...value, scope: value.scopes.join(" ") }, { status: response.status });
  },
  checkOperation: "contacts.list",
  operations: {
    ...objectOperations("contacts"), ...objectOperations("deals"),
    "deals.associateContact": { scopes: ["crm.objects.contacts.write", "crm.objects.deals.write"], request(input) {
      const { contactId, dealId } = validateSchemaPayload({ schema: associationSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "PUT", url: `${base}/deals/${dealId}/associations/default/contacts/${contactId}` };
    }, validateResult: value => Array.isArray(value?.results) },
    "pipelines.list": { ...jsonOperation("https://api.hubapi.com/crm/pipelines/2026-09/deals", {}, value => Array.isArray(value?.results)), scopes: ["crm.objects.deals.read"] }
  }
});
export { hubspotProvider };
