import { AthenaClient, GetWorkGroupCommand, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand, StopQueryExecutionCommand, ListDataCatalogsCommand, ListDatabasesCommand, ListTableMetadataCommand } from "@aws-sdk/client-athena";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { awsAthenaDefinition } from "../shared/aws.js";
import { awsOrigin, awsOperation, awsExchange } from "./awsTransport.js";

const queryId = { type: "string", required: true, minLength: 1, maxLength: 128, pattern: "^\\S+$" };
const validQuery = (r) => typeof r?.QueryExecution?.QueryExecutionId === "string" && typeof r.QueryExecution.WorkGroup === "string" &&
  ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(r.QueryExecution.Status?.State);
const metadataPage = {
  maxResults: { type: "integer", min: 1, max: 50, defaultTo: 50 },
  nextToken: { type: "string", noTrim: true, minLength: 1, maxLength: 1024 }
};
const catalog = { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 256 };
const metadataInput = (v, s) => ({ input: { WorkGroup: s.workgroup, MaxResults: v.maxResults,
  ...(v.nextToken ? { NextToken: v.nextToken } : {}),
  ...(v.catalog ? { CatalogName: v.catalog } : {}),
  ...(v.database ? { DatabaseName: v.database } : {}) } });
const validCursor = (r) => r.NextToken === undefined || typeof r.NextToken === "string" && r.NextToken.length > 0 && r.NextToken.length <= 1024;
const validColumns = (columns) => columns === undefined || Array.isArray(columns) && columns.every((c) => typeof c?.Name === "string" && typeof c.Type === "string");
const queryInput = (v) => ({ input: { QueryExecutionId: v.queryId } });
const awsAthenaProvider = Object.freeze({
  ...awsAthenaDefinition,
  apiOrigins: (settings) => [awsOrigin("athena", settings)], apiKey: { headers: () => ({}) }, checkOperation: "workgroup.get",
  exchange: awsExchange("athena", AthenaClient, async (client, body, { settings, signal }) => {
    const send = (command) => client.send(command, { abortSignal: signal });
    if (body.command === "GetWorkGroup") {
      const result = await send(new GetWorkGroupCommand(body.input));
      if (result.WorkGroup?.Name !== settings.workgroup) throw new ConnectorError("connector_response_invalid", "Athena returned a different workgroup.", { statusCode: 502 });
      return result;
    }
    if (body.command === "ListDataCatalogs") return send(new ListDataCatalogsCommand(body.input));
    if (body.command === "ListDatabases") return send(new ListDatabasesCommand(body.input));
    if (body.command === "ListTableMetadata") return send(new ListTableMetadataCommand(body.input));
    if (body.command === "StartQueryExecution") return send(new StartQueryExecutionCommand(body.input));
    const query = await send(new GetQueryExecutionCommand({ QueryExecutionId: body.input.QueryExecutionId }));
    if (!validQuery(query) || query.QueryExecution.QueryExecutionId !== body.input.QueryExecutionId) {
      throw new ConnectorError("connector_response_invalid", "Athena returned an unexpected query.", { statusCode: 502 });
    }
    if (query.QueryExecution.WorkGroup !== settings.workgroup) {
      throw new ConnectorError("connector_access_denied", "This query belongs to a different workgroup.", { statusCode: 403 });
    }
    if (body.command === "GetQueryExecution") return query;
    if (body.command === "GetQueryResults") return send(new GetQueryResultsCommand(body.input));
    return send(new StopQueryExecutionCommand(body.input));
  }),
  operations: {
    "catalogs.list": awsOperation("athena", "ListDataCatalogs", {
      ...metadataPage, maxResults: { ...metadataPage.maxResults, min: 2 }
    }, metadataInput, (r) => Array.isArray(r?.DataCatalogsSummary) && r.DataCatalogsSummary.length <= 50 &&
      r.DataCatalogsSummary.every((c) => typeof c?.CatalogName === "string" && typeof c.Type === "string") && validCursor(r)),
    "databases.list": awsOperation("athena", "ListDatabases", { ...metadataPage, catalog }, metadataInput,
      (r) => Array.isArray(r?.DatabaseList) && r.DatabaseList.length <= 50 &&
        r.DatabaseList.every((d) => typeof d?.Name === "string") && validCursor(r)),
    "tables.list": awsOperation("athena", "ListTableMetadata", { ...metadataPage, catalog,
      database: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 128 }
    }, metadataInput, (r) => Array.isArray(r?.TableMetadataList) && r.TableMetadataList.length <= 50 &&
      r.TableMetadataList.every((t) => typeof t?.Name === "string" && validColumns(t.Columns) && validColumns(t.PartitionKeys)) && validCursor(r)),
    "workgroup.get": awsOperation("athena", "GetWorkGroup", {}, (_, s) => ({ input: { WorkGroup: s.workgroup } }),
      (r) => typeof r?.WorkGroup?.Name === "string" && ["ENABLED", "DISABLED"].includes(r.WorkGroup.State)),
    "query.start": awsOperation("athena", "StartQueryExecution", {
      sql: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 262144,
        validator: (value) => (value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= 262144) || "Enter SQL of at most 262144 UTF-8 bytes." },
      clientRequestToken: { type: "string", required: true, noTrim: true, minLength: 32, maxLength: 128 },
      database: { type: "string", minLength: 1, maxLength: 255 }, catalog: { type: "string", minLength: 1, maxLength: 256 }
    }, (v, s) => ({ input: { QueryString: v.sql, ClientRequestToken: v.clientRequestToken, WorkGroup: s.workgroup,
      ...(v.database || v.catalog ? { QueryExecutionContext: { ...(v.database ? { Database: v.database } : {}), ...(v.catalog ? { Catalog: v.catalog } : {}) } } : {}),
      ...(s.resultLocation ? { ResultConfiguration: { OutputLocation: s.resultLocation } } : {}) } }),
    (r) => typeof r?.QueryExecutionId === "string" && /^\S{1,128}$/u.test(r.QueryExecutionId)),
    "query.status": awsOperation("athena", "GetQueryExecution", { queryId }, queryInput, validQuery),
    "query.results": awsOperation("athena", "GetQueryResults", { queryId,
      maxResults: { type: "integer", min: 1, max: 1000, defaultTo: 100 }, nextToken: { type: "string", noTrim: true, minLength: 1, maxLength: 1024 }
    }, (v) => ({ input: { QueryExecutionId: v.queryId, MaxResults: v.maxResults, QueryResultType: "DATA_ROWS", ...(v.nextToken ? { NextToken: v.nextToken } : {}) } }),
    (r) => Array.isArray(r?.ResultSet?.ResultSetMetadata?.ColumnInfo) &&
      r.ResultSet.ResultSetMetadata.ColumnInfo.every((c) => typeof c.Name === "string" && typeof c.Type === "string") &&
      Array.isArray(r.ResultSet.Rows) && r.ResultSet.Rows.length <= 1000 &&
      r.ResultSet.Rows.every((row) => Array.isArray(row.Data) && row.Data.every((cell) => cell && (cell.VarCharValue === undefined || typeof cell.VarCharValue === "string"))) &&
      (r.NextToken === undefined || typeof r.NextToken === "string" && r.NextToken.length > 0)),
    "query.cancel": awsOperation("athena", "StopQueryExecution", { queryId }, queryInput, (r) => r && Object.keys(r).length === 0)
  }
});

export { awsAthenaProvider };
