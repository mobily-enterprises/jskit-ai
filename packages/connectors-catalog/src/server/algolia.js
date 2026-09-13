import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { algoliaDefinition } from "../shared/algolia.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = ({ applicationId }) => `https://${applicationId.toLowerCase()}.algolia.net`;
const searchSchema = createSchema({
  indexName: { type: "string", required: true, minLength: 1, maxLength: 255,
    validator: (value) => ![".", ".."].includes(value) || "Enter an index name." },
  query: { type: "string", defaultTo: "", maxLength: 512,
    validator: (value) => Buffer.byteLength(value, "utf8") <= 512 || "Use a query of at most 512 UTF-8 bytes." },
  page: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
  hitsPerPage: { type: "integer", min: 1, max: 1000, defaultTo: 20 }
});
const indexField = { type: "string", required: true, minLength: 1, maxLength: 255,
  validator: value => ![".", ".."].includes(value) || "Enter an index name." };
const objectField = { type: "string", required: true, minLength: 1, maxLength: 512,
  validator: value => ![".", ".."].includes(value) || "Enter a record ID." };
const writeSchema = createSchema({ indexName: indexField, objectID: objectField,
  attributes: { type: "object", required: true, additionalProperties: true,
    validator: value => (Object.keys(value).length > 0 && !Object.hasOwn(value, "objectID")) || "Provide attributes without objectID; use the separate record ID." } });
const deleteSchema = createSchema({ indexName: indexField, objectID: objectField });
const taskSchema = createSchema({ indexName: indexField,
  taskID: { type: "integer", required: true, min: 0, max: Number.MAX_SAFE_INTEGER } });
const taskResult = result => Number.isSafeInteger(result?.taskID) && result.taskID >= 0;
function writeOperation(method, suffix = "") {
  return { scopes: [], request(input, settings) {
    const { indexName, objectID, attributes } = validateSchemaPayload({ schema: writeSchema, mode: "replace" }, input, { statusCode: 422 });
    return { method, url: `${origin(settings)}/1/indexes/${encodeURIComponent(indexName)}/${encodeURIComponent(objectID)}${suffix}`,
      body: attributes };
  }, validateResult: result => taskResult(result) && typeof result.objectID === "string" };
}
const algoliaProvider = Object.freeze({
  ...algoliaDefinition,
  apiOrigins: (settings) => [origin(settings)],
  apiKey: { headers: (key, settings) => ({ "X-Algolia-Application-Id": settings.applicationId, "X-Algolia-API-Key": key }) },
  checkOperation: "indices.list",
  operations: {
    "records.replace": writeOperation("PUT"),
    "records.update": writeOperation("POST", "/partial?createIfNotExists=false"),
    "records.delete": { scopes: [], request(input, settings) {
      const { indexName, objectID } = validateSchemaPayload({ schema: deleteSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "DELETE", url: `${origin(settings)}/1/indexes/${encodeURIComponent(indexName)}/${encodeURIComponent(objectID)}` };
    }, validateResult: taskResult },
    "tasks.get": { scopes: [], request(input, settings) {
      const { indexName, taskID } = validateSchemaPayload({ schema: taskSchema, mode: "replace" }, input, { statusCode: 422 });
      return { method: "GET", url: `${origin(settings)}/1/indexes/${encodeURIComponent(indexName)}/task/${taskID}` };
    }, validateResult: result => ["published", "notPublished"].includes(result?.status) },
    "indices.list": jsonOperation((settings) => `${origin(settings)}/1/indexes`, {
      page: { type: "integer", min: 0, max: 2147483647, defaultTo: 0 },
      hitsPerPage: { type: "integer", min: 1, max: 1000, defaultTo: 100 }
    }, (result) => Array.isArray(result?.items) && (result.nbPages === undefined || Number.isInteger(result.nbPages) && result.nbPages >= 0)),
    "index.search": {
      scopes: [],
      request(input, settings) {
        const { indexName, ...body } = validateSchemaPayload({ schema: searchSchema, mode: "replace" }, input, { statusCode: 422 });
        return { method: "POST", url: `${origin(settings)}/1/indexes/${encodeURIComponent(indexName)}/query`, body };
      },
      validateResult: (result) => Array.isArray(result?.hits) && ["nbHits", "nbPages", "page", "hitsPerPage"].every((key) => Number.isInteger(result[key]) && result[key] >= 0)
    }
  }
});
export { algoliaProvider };
