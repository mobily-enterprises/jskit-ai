import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { contentfulDefinition } from "../shared/tokens.js";
import { jsonOperation } from "./jsonOperation.js";

const text = { type: "string", minLength: 1, maxLength: 256 };
const page = { limit: { type: "integer", min: 1, max: 1000, defaultTo: 1 }, skip: { type: "integer", min: 0, defaultTo: 0 } };
const localized = { locale: text };
const resource = type => result => result?.sys?.type === type && typeof result.sys.id === "string" && result.sys.id.length > 0;
const collection = type => result => result?.sys?.type === "Array" && Array.isArray(result.items) && result.items.every(resource(type)) &&
  Number.isInteger(result.total) && result.total >= 0 && Number.isInteger(result.skip) && result.skip >= 0 && Number.isInteger(result.limit) && result.limit >= 0;
const endpoint = (settings, path) => `https://${settings.region === "eu" ? "cdn.eu.contentful.com" : "cdn.contentful.com"}/spaces/${encodeURIComponent(settings.spaceId)}/environments/${encodeURIComponent(settings.environmentId || "master")}/${path}`;
function getOperation(path, type, fields = {}) {
  const schema = createSchema({ id: { type: "string", required: true, minLength: 1, maxLength: 64,
    validator: value => /^[a-zA-Z0-9_-]+$/u.test(value) || "Use the Contentful resource ID." }, ...fields });
  return { scopes: [], request(input, settings) {
    const { id, ...values } = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
    const url = new URL(endpoint(settings, `${path}/${encodeURIComponent(id)}`));
    for (const [name, value] of Object.entries(values)) url.searchParams.set(name, String(value));
    return { method: "GET", url: url.href };
  }, validateResult: resource(type) };
}
const contentfulProvider = Object.freeze({
  ...contentfulDefinition, apiOrigins: ["https://cdn.contentful.com", "https://cdn.eu.contentful.com"],
  apiKey: { headers: key => ({ Authorization: `Bearer ${key}` }) }, checkOperation: "entries.list",
  operations: {
    "entries.list": jsonOperation(settings => endpoint(settings, "entries"), {
      ...page, ...localized, content_type: { ...text, maxLength: 64 },
      include: { type: "integer", min: 0, max: 10 }, order: text, query: { ...text, maxLength: 1000 },
      "sys.id": { ...text, maxLength: 64 }
    }, collection("Entry")),
    "entries.get": getOperation("entries", "Entry", localized),
    "assets.list": jsonOperation(settings => endpoint(settings, "assets"), { ...page, ...localized, order: text, query: { ...text, maxLength: 1000 } }, collection("Asset")),
    "assets.get": getOperation("assets", "Asset", localized),
    "contentTypes.list": jsonOperation(settings => endpoint(settings, "content_types"), page, collection("ContentType")),
    "contentTypes.get": getOperation("content_types", "ContentType"),
    "locales.list": jsonOperation(settings => endpoint(settings, "locales"), page, collection("Locale"))
  }
});
export { contentfulProvider };
