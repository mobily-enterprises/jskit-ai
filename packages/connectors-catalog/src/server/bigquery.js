import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { jsonOperation } from "./jsonOperation.js";
import { bigqueryDefinition } from "../shared/google.js";
import { googleRead, googleProvider, pageToken } from "./google.js";
const origin = "https://bigquery.googleapis.com";
const queryScopes = ["https://www.googleapis.com/auth/bigquery", "https://www.googleapis.com/auth/cloud-platform"];
const resultFields = {
  maxResults: { type: "integer", min: 1, max: 1000, defaultTo: 100 },
  timeoutMs: { type: "integer", min: 0, max: 10000, defaultTo: 1000 },
  location: { type: "string", minLength: 1, maxLength: 100, pattern: "^[a-zA-Z0-9-]+$" }
};
const resultsSchema = createSchema({ ...resultFields,
  jobId: { type: "string", required: true, minLength: 1, maxLength: 1024, pattern: "^[a-zA-Z0-9_-]+$" }, pageToken: { ...pageToken, noTrim: true }
});
const validQueryResult = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value) && !value.error &&
  typeof value.jobComplete === "boolean" && (value.rows === undefined || Array.isArray(value.rows) && value.rows.every((row) =>
    Array.isArray(row?.f) && row.f.every((cell) => cell && typeof cell === "object" && !Array.isArray(cell) && Object.hasOwn(cell, "v")))) &&
  (value.schema === undefined || Array.isArray(value.schema?.fields)) &&
  (value.pageToken === undefined || typeof value.pageToken === "string") &&
  (value.totalRows === undefined || (typeof value.totalRows === "string" && /^\d+$/.test(value.totalRows))) &&
  (value.jobComplete || (typeof value.jobReference?.jobId === "string" && value.jobReference.jobId.length > 0)));
const submitQuery = jsonOperation((settings) => `${origin}/bigquery/v2/projects/${encodeURIComponent(settings.projectId)}/queries`, {
  ...resultFields,
  query: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1000000, validator: (value) => value.trim().length > 0 || "Enter SQL." },
  parameters: { type: "array", validator: (values) => (values.length <= 100 && new Set(values.map((value) => value.name)).size === values.length) || "Use at most 100 uniquely named parameters.",
    items: { type: "object", schema: createSchema({
      name: { type: "string", required: true, minLength: 1, maxLength: 128, pattern: "^[a-zA-Z_][a-zA-Z0-9_]*$" },
      type: { type: "string", required: true, enum: ["STRING", "INT64", "FLOAT64", "NUMERIC", "BIGNUMERIC", "BOOL", "DATE", "DATETIME", "TIME", "TIMESTAMP", "BYTES"] },
      value: { type: "string", required: true, noTrim: true, maxLength: 1000000 }
    }) }
  },
  maximumBytesBilled: { type: "string", minLength: 1, maxLength: 19, pattern: "^[0-9]+$" },
  requestId: { type: "string", minLength: 1, maxLength: 36, pattern: "^[a-zA-Z0-9_-]+$" }
}, validQueryResult, "POST");
const metadataScopes = [...queryScopes, "https://www.googleapis.com/auth/bigquery.readonly", "https://www.googleapis.com/auth/cloud-platform.read-only"];
const resourceId = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 1024,
  // eslint-disable-next-line no-control-regex -- Reject literal control characters in provider input.
  validator: (value) => (!/[\/\\\u0000-\u001f]/u.test(value) && value !== "." && value !== "..") || "Enter a resource ID, not a path." };
const metadataPage = { maxResults: resultFields.maxResults, pageToken: { ...pageToken, noTrim: true } };
const jobFields = { jobId: resultsSchema.getFieldDefinitions().jobId, location: resultFields.location };
const validJob = (job) => Boolean(typeof job?.jobReference?.jobId === "string" && job.jobReference.jobId.length > 0 && typeof job.jobReference.projectId === "string" &&
  ["PENDING", "RUNNING", "DONE"].includes(job.status?.state));
const validPage = (result, field, reference) => Boolean(result && typeof result === "object" && !Array.isArray(result) && !result.error &&
  (result[field] === undefined || Array.isArray(result[field]) && result[field].every((item) => typeof item?.[reference]?.projectId === "string")) &&
  (result.nextPageToken === undefined || typeof result.nextPageToken === "string"));

function projectOperation(fields, destination, validateResult, scopes = metadataScopes, method = "GET") {
  const schema = createSchema(fields);
  return { scopes, validateResult,
    request(input, settings) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const { path, query = {} } = destination(values);
      const url = new URL(`${origin}/bigquery/v2/projects/${encodeURIComponent(settings.projectId)}${path}`);
      for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value));
      return { method, url: url.href };
    }
  };
}
const bigqueryProvider = googleProvider(bigqueryDefinition, origin, "projects.list", {
  "datasets.list": projectOperation(metadataPage, (query) => ({ path: "/datasets", query }),
    (result) => validPage(result, "datasets", "datasetReference")),
  "tables.list": projectOperation({ datasetId: resourceId, ...metadataPage }, ({ datasetId, ...query }) => ({ path: `/datasets/${encodeURIComponent(datasetId)}/tables`, query }),
    (result) => validPage(result, "tables", "tableReference")),
  "tables.get": projectOperation({ datasetId: resourceId, tableId: resourceId }, ({ datasetId, tableId }) => ({ path: `/datasets/${encodeURIComponent(datasetId)}/tables/${encodeURIComponent(tableId)}` }),
    (result) => Boolean(result?.tableReference?.tableId && result.tableReference.datasetId && typeof result.tableReference.projectId === "string" &&
      (result.schema === undefined || Array.isArray(result.schema.fields)))),
  "jobs.get": projectOperation(jobFields, ({ jobId, ...query }) => ({ path: `/jobs/${encodeURIComponent(jobId)}`, query }), validJob),
  "jobs.cancel": projectOperation(jobFields, ({ jobId, ...query }) => ({ path: `/jobs/${encodeURIComponent(jobId)}/cancel`, query }),
    (result) => validJob(result?.job), queryScopes, "POST"),
  "jobs.query": { ...submitQuery, scopes: queryScopes,
    request(input, settings) {
      const request = submitQuery.request(input, settings);
      const { parameters, ...body } = request.body;
      return { ...request, body: { ...body, useLegacySql: false,
        ...(parameters?.length ? { parameterMode: "NAMED", queryParameters: parameters.map(({ name, type, value }) => ({
          name, parameterType: { type }, parameterValue: { value }
        })) } : {})
      } };
    }
  },
  "jobs.getQueryResults": { scopes: queryScopes, validateResult: validQueryResult,
    request(input, settings) {
      const { jobId, ...query } = validateSchemaPayload({ schema: resultsSchema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(`${origin}/bigquery/v2/projects/${encodeURIComponent(settings.projectId)}/queries/${encodeURIComponent(jobId)}`);
      for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
      return { method: "GET", url: url.href };
    }
  },
  "projects.list": googleRead(["bigquery.readonly", "bigquery", "cloud-platform.read-only", "cloud-platform"], {
    maxResults: { type: "integer", min: 1, max: 50, defaultTo: 50 }, pageToken
  }, (query) => ({ url: `${origin}/bigquery/v2/projects`, query }),
  (result) => Boolean(result && typeof result === "object" && !Array.isArray(result) && !result.error
    && Number.isInteger(result.totalItems) && result.totalItems >= 0
    && (Array.isArray(result.projects) || (result.totalItems === 0 && result.projects === undefined))))
});
export { bigqueryProvider };
