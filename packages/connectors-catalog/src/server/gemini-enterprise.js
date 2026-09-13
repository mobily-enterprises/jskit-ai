import { createSchema } from "json-rest-schema";
import { geminiEnterpriseDefinition, geminiEnterpriseScope } from "../shared/gemini-enterprise.js";
import { googleProvider } from "./google.js";
import { jsonOperation } from "./jsonOperation.js";

function apiOrigin({ location = "global" } = {}) {
  return `https://${location === "global" ? "" : `${location}-`}discoveryengine.googleapis.com`;
}
function engineUrl(settings) {
  return `${apiOrigin(settings)}/v1/projects/${settings.projectId}/locations/${settings.location || "global"}/collections/default_collection/engines/${settings.engineId}`;
}
const object = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value) => typeof value === "string" && value.length > 0;
const geminiEnterpriseProvider = Object.freeze({
  ...googleProvider(geminiEnterpriseDefinition, apiOrigin(), "engine.get", {
    "engine.get": {
      ...jsonOperation(engineUrl, {}, (result) => object(result) && !result.error && text(result.displayName)
        && typeof result.name === "string" && /^projects\/[a-z0-9-]+\/locations\/(global|us|eu)\/collections\/default_collection\/engines\/[a-z0-9][a-z0-9_-]{0,62}$/u.test(result.name)),
      scopes: [geminiEnterpriseScope]
    },
    search: {
      ...jsonOperation((settings) => `${engineUrl(settings)}/servingConfigs/default_serving_config:search`, {
        query: { type: "string", required: true, minLength: 1, maxLength: 4096, noTrim: true },
        pageSize: { type: "integer", min: 1, max: 25, defaultTo: 10 },
        contentSearchSpec: { type: "object", schema: createSchema({
          snippetSpec: { type: "object", schema: createSchema({ returnSnippet: { type: "boolean", required: true } }) },
          summarySpec: { type: "object", schema: createSchema({
            summaryResultCount: { type: "integer", required: true, min: 1, max: 10 },
            includeCitations: { type: "boolean", defaultTo: true },
            ignoreAdversarialQuery: { type: "boolean", defaultTo: true },
            ignoreNonSummarySeekingQuery: { type: "boolean", defaultTo: true },
            ignoreLowRelevantContent: { type: "boolean", defaultTo: true }
          }) }
        }) },
        pageToken: { type: "string", minLength: 1, maxLength: 16000, noTrim: true }
      }, (result) => object(result) && !result.error && text(result.attributionToken)
        && (result.totalSize === undefined || Number.isInteger(result.totalSize) && result.totalSize >= 0)
        && (result.nextPageToken === undefined || typeof result.nextPageToken === "string")
        && (result.redirectUri === undefined || typeof result.redirectUri === "string")
        && (result.results === undefined || Array.isArray(result.results) && result.results.length <= 25
          && result.results.every((item) => object(item) && text(item.id) && object(item.document))), "POST"),
      scopes: [geminiEnterpriseScope]
    }
  }),
  apiOrigins: (settings) => [apiOrigin(settings)]
});
export { geminiEnterpriseProvider };
