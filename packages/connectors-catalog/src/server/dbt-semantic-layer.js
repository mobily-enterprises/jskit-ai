import { createSchema } from "json-rest-schema";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { dbtSemanticLayerDefinition } from "../shared/dbt-semantic-layer.js";
import { graphqlOperation } from "./graphqlOperation.js";

const origin = (settings) => `https://${settings.host}`;
const endpoint = (settings) => `${origin(settings)}/api/graphql`;
const text = (value) => typeof value === "string" && value.length > 0;
const description = (value) => value === null || typeof value === "string";
const paging = {
  pageNum: { type: "integer", min: 1, max: 2_147_483_647, defaultTo: 1 },
  pageSize: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  search: { type: "string", maxLength: 512 }
};
const pageFields = "pageNum pageSize totalItems totalPages items { name description type }";
const validPage = (page, typed = true) => Array.isArray(page?.items) && page.items.length <= 100 &&
  page.items.every((item) => text(item?.name) && description(item.description) && (!typed || text(item.type))) &&
  Number.isSafeInteger(page.pageNum) && page.pageNum >= 1 && Number.isSafeInteger(page.pageSize) && page.pageSize >= 1 && page.pageSize <= 100 &&
  Number.isSafeInteger(page.totalItems) && page.totalItems >= page.items.length && Number.isSafeInteger(page.totalPages) && page.totalPages >= 0;

function environmentOperation(query, fields, validateData) {
  const operation = graphqlOperation(endpoint, query, fields, validateData);
  return { ...operation, request(input, settings) {
    const request = operation.request(input, settings);
    request.body.variables.environmentId = settings.environmentId;
    return request;
  } };
}
const dbtSemanticLayerProvider = Object.freeze({
  ...dbtSemanticLayerDefinition,
  apiOrigins: (settings) => [origin(settings)],
  apiKey: { headers: (key) => {
    if (/[\s\p{Cc}]/u.test(key)) throw new ConnectorError("connector_binding_missing", "Use a dbt service token without spaces or control characters.");
    return { Authorization: `Bearer ${key}` };
  } },
  checkOperation: "environment.read",
  operations: {
    "queries.create": environmentOperation("mutation ConnectorDbtQuery($environmentId: BigInt!, $metrics: [MetricInput!]!, $groupBy: [GroupByInput!], $where: [WhereInput!], $limit: Int!) { createQuery(environmentId: $environmentId, metrics: $metrics, groupBy: $groupBy, where: $where, limit: $limit) { queryId } }", {
      metrics: { type: "array", required: true, validator: (value) => (value.length >= 1 && value.length <= 100) || "Choose between 1 and 100 metrics.",
        items: { type: "object", schema: createSchema({ name: { type: "string", required: true, minLength: 1, maxLength: 512 }, alias: { type: "string", minLength: 1, maxLength: 512 } }) } },
      groupBy: { type: "array", validator: (value) => value.length <= 100 || "Choose at most 100 dimensions.",
        items: { type: "object", schema: createSchema({ name: { type: "string", required: true, minLength: 1, maxLength: 512 }, grain: { type: "string", enum: ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"] } }) } },
      where: { type: "array", validator: (value) => value.length <= 20 || "Use at most 20 filters.",
        items: { type: "object", schema: createSchema({ sql: { type: "string", required: true, minLength: 1, maxLength: 4000 } }) } },
      limit: { type: "integer", min: 1, max: 10000, defaultTo: 100 }
    }, (data) => text(data?.createQuery?.queryId)),
    "queries.get": environmentOperation("query ConnectorDbtQueryResult($environmentId: BigInt!, $queryId: String!, $pageNum: Int!) { query(environmentId: $environmentId, queryId: $queryId, pageNum: $pageNum) { status error totalPages jsonResult(orient: TABLE, encoded: false) } }", {
      queryId: { type: "string", required: true, minLength: 1, maxLength: 512 },
      pageNum: { type: "integer", min: 1, max: 2_147_483_647, defaultTo: 1 }
    }, (data) => text(data?.query?.status) && description(data.query.error) &&
      (data.query.totalPages === null || (Number.isSafeInteger(data.query.totalPages) && data.query.totalPages >= 0)) &&
      (data.query.jsonResult === null || (typeof data.query.jsonResult === "object" && Array.isArray(data.query.jsonResult?.data) && Array.isArray(data.query.jsonResult?.schema?.fields)))),
    "environment.read": environmentOperation("query ConnectorDbtEnvironment($environmentId: BigInt!) { environmentInfo(environmentId: $environmentId) { dialect } }", {},
      (data) => text(data?.environmentInfo?.dialect)),
    "metrics.list": environmentOperation(`query ConnectorDbtMetrics($environmentId: BigInt!, $pageNum: Int!, $pageSize: Int!, $search: String) { metricsPaginated(environmentId: $environmentId, pageNum: $pageNum, pageSize: $pageSize, search: $search) { ${pageFields} } }`, paging,
      (data) => validPage(data?.metricsPaginated)),
    "dimensions.list": environmentOperation(`query ConnectorDbtDimensions($environmentId: BigInt!, $metrics: [MetricInput!]!, $pageNum: Int!, $pageSize: Int!, $search: String) { dimensionsPaginated(environmentId: $environmentId, metrics: $metrics, pageNum: $pageNum, pageSize: $pageSize, search: $search) { ${pageFields} } }`, {
      ...paging, metrics: { type: "array", required: true, validator: (value) => (value.length >= 1 && value.length <= 100) || "Choose between 1 and 100 metrics.",
        items: { type: "object", schema: createSchema({ name: { type: "string", required: true, minLength: 1, maxLength: 512 } }) } }
    }, (data) => validPage(data?.dimensionsPaginated)),
    "savedQueries.list": environmentOperation(`query ConnectorDbtSavedQueries($environmentId: BigInt!, $pageNum: Int!, $pageSize: Int!, $search: String) { savedQueriesPaginated(environmentId: $environmentId, pageNum: $pageNum, pageSize: $pageSize, search: $search) { pageNum pageSize totalItems totalPages items { name description } } }`, paging,
      (data) => validPage(data?.savedQueriesPaginated, false))
  },
  async exchange(address, options, { request }) {
    const result = await request(address, options);
    if (Array.isArray(result?.errors) && result.errors.length > 0) {
      throw new ConnectorError("connector_provider_failed", "dbt could not complete the requested operation. Check the environment and service token permissions.", { statusCode: 502 });
    }
    const queryResult = result?.data?.query;
    if (queryResult) {
      if (queryResult.status === "FAILED") {
        throw new ConnectorError("connector_provider_failed", "dbt query failed. Inspect its status in dbt; do not automatically submit it again.", { statusCode: 502 });
      }
      if (queryResult.jsonResult !== null && queryResult.jsonResult !== undefined) {
        if (typeof queryResult.jsonResult !== "string" || Buffer.byteLength(queryResult.jsonResult) > 5 * 1024 * 1024) {
          throw new ConnectorError("connector_response_invalid", "dbt returned an invalid or oversized JSON result page.", { statusCode: 502 });
        }
        try { queryResult.jsonResult = JSON.parse(queryResult.jsonResult); }
        catch { throw new ConnectorError("connector_response_invalid", "dbt returned an invalid JSON result page.", { statusCode: 502 }); }
        if (!Array.isArray(queryResult.jsonResult?.data) || queryResult.jsonResult.data.length > 1024 || !Array.isArray(queryResult.jsonResult?.schema?.fields)) {
          throw new ConnectorError("connector_response_invalid", "dbt returned an invalid JSON table.", { statusCode: 502 });
        }
      } else if (queryResult.status === "SUCCESSFUL") {
        throw new ConnectorError("connector_response_invalid", "dbt completed without a JSON result table.", { statusCode: 502 });
      }
    }
    const page = result?.data?.metricsPaginated || result?.data?.dimensionsPaginated || result?.data?.savedQueriesPaginated;
    if (page && (page.pageNum !== options.body.variables.pageNum || page.pageSize !== options.body.variables.pageSize || page.items?.length > options.body.variables.pageSize)) {
      throw new ConnectorError("connector_response_invalid", "dbt returned an unexpected metadata page.", { statusCode: 502 });
    }
    return result;
  }
});

export { dbtSemanticLayerProvider };
