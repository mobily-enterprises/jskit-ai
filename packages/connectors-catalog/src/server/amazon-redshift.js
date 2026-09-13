import { RedshiftDataClient, ListDatabasesCommand, ListSchemasCommand, ListTablesCommand, DescribeTableCommand, ExecuteStatementCommand, DescribeStatementCommand, GetStatementResultCommand, CancelStatementCommand } from "@aws-sdk/client-redshift-data";
import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { createSchema } from "json-rest-schema";
import { amazonRedshiftDefinition } from "../shared/amazon-redshift.js";
import { awsOrigin, awsOperation, awsExchange } from "./awsTransport.js";

const statementPattern = "^[a-z0-9]{8}(-[a-z0-9]{4}){3}-[a-z0-9]{12}(:[0-9]{1,2})?$";
const statementId = { type: "string", required: true, pattern: statementPattern };
const text = { type: "string", noTrim: true, minLength: 1, maxLength: 1024 };
const nextToken = { ...text, maxLength: 8192 };
const maxResults = { type: "integer", min: 1, max: 1000, defaultTo: 100 };
const hasCursor = (r) => r?.NextToken === undefined || typeof r.NextToken === "string";
const validId = (r) => typeof r?.Id === "string" && new RegExp(statementPattern, "u").test(r.Id);
const validStatement = (r) => validId(r) && typeof r.Database === "string" &&
  ["SUBMITTED", "PICKED", "STARTED", "FINISHED", "ABORTED", "FAILED"].includes(r.Status);
const validColumns = (columns) => Array.isArray(columns) && columns.every((c) => c && typeof c.name === "string" && typeof c.typeName === "string");
const target = (s) => ({ Database: s.database, ...(s.deploymentType === "provisioned"
  ? { ClusterIdentifier: s.clusterIdentifier, ...(s.databaseUser ? { DbUser: s.databaseUser } : {}) }
  : { WorkgroupName: s.workgroup }) });
const pageInput = (v) => ({ ...(v.nextToken ? { NextToken: v.nextToken } : {}), MaxResults: v.maxResults });

function assertTarget(result, settings) {
  const matches = result.Database === settings.database && (settings.deploymentType === "provisioned"
    ? result.ClusterIdentifier === settings.clusterIdentifier && !result.WorkgroupName && (!settings.databaseUser || result.DbUser === settings.databaseUser)
    : result.WorkgroupName === settings.workgroup && !result.ClusterIdentifier);
  if (!matches) throw new ConnectorError("connector_access_denied", "This statement belongs to a different Redshift target.", { statusCode: 403 });
}

function validCell(cell) {
  if (!cell || Object.keys(cell).length !== 1) return false;
  const [key, value] = Object.entries(cell)[0];
  if (key === "isNull") return value === true;
  if (key === "booleanValue") return typeof value === "boolean";
  if (key === "longValue") return Number.isSafeInteger(value);
  if (key === "doubleValue") return typeof value === "number" && Number.isFinite(value);
  if (key === "stringValue") return typeof value === "string";
  return key === "blobValue" && value instanceof Uint8Array;
}

const amazonRedshiftProvider = Object.freeze({
  ...amazonRedshiftDefinition,
  apiOrigins: (settings) => [awsOrigin("redshift-data", settings)], apiKey: { headers: () => ({}) }, checkOperation: "tables.list",
  exchange: awsExchange("redshift-data", RedshiftDataClient, async (client, body, { settings, signal }) => {
    const send = (command) => client.send(command, { abortSignal: signal });
    if (body.command === "ListDatabases") return send(new ListDatabasesCommand(body.input));
    if (body.command === "ListSchemas") return send(new ListSchemasCommand(body.input));
    if (body.command === "ListTables") return send(new ListTablesCommand(body.input));
    if (body.command === "DescribeTable") return send(new DescribeTableCommand(body.input));
    if (body.command === "ExecuteStatement") {
      const result = await send(new ExecuteStatementCommand(body.input));
      if (!validId(result)) throw new ConnectorError("connector_response_invalid", "Redshift did not return a statement identifier.", { statusCode: 502 });
      assertTarget(result, settings);
      return result;
    }
    const statement = await send(new DescribeStatementCommand({ Id: body.input.Id }));
    if (!validStatement(statement) || statement.Id !== body.input.Id) throw new ConnectorError("connector_response_invalid", "Redshift returned an unexpected statement.", { statusCode: 502 });
    assertTarget(statement, settings);
    if (body.command === "DescribeStatement") return statement;
    if (body.command === "CancelStatement") return send(new CancelStatementCommand(body.input));
    if (statement.Status !== "FINISHED" || !statement.HasResultSet) throw new ConnectorError("connector_result_unavailable", "This statement has no finished result set.", { statusCode: 409 });
    return send(new GetStatementResultCommand(body.input));
  }),
  operations: {
    "databases.list": awsOperation("redshift-data", "ListDatabases", { maxResults, nextToken },
      (v, s) => ({ input: { ...target(s), ...pageInput(v) } }),
      (r) => Array.isArray(r?.Databases) && r.Databases.length <= 1000 && r.Databases.every((name) => typeof name === "string") && hasCursor(r)),
    "schemas.list": awsOperation("redshift-data", "ListSchemas", { maxResults, nextToken, schemaPattern: text },
      (v, s) => ({ input: { ...target(s), ...pageInput(v), ...(v.schemaPattern ? { SchemaPattern: v.schemaPattern } : {}) } }),
      (r) => Array.isArray(r?.Schemas) && r.Schemas.length <= 1000 && r.Schemas.every((name) => typeof name === "string") && hasCursor(r)),
    "tables.list": awsOperation("redshift-data", "ListTables", { maxResults, nextToken, schemaPattern: text, tablePattern: text },
      (v, s) => ({ input: { ...target(s), ...pageInput(v), ...(v.schemaPattern ? { SchemaPattern: v.schemaPattern } : {}), ...(v.tablePattern ? { TablePattern: v.tablePattern } : {}) } }),
      (r) => Array.isArray(r?.Tables) && r.Tables.length <= 1000 && r.Tables.every((t) => typeof t?.name === "string" && typeof t.schema === "string" && typeof t.type === "string") && hasCursor(r)),
    "table.describe": awsOperation("redshift-data", "DescribeTable", { table: { ...text, required: true }, schema: text, maxResults, nextToken },
      (v, s) => ({ input: { ...target(s), ...pageInput(v), Table: v.table, ...(v.schema ? { Schema: v.schema } : {}) } }),
      (r) => validColumns(r?.ColumnList) && r.ColumnList.length <= 1000 && typeof r.TableName === "string" && hasCursor(r)),
    "query.start": awsOperation("redshift-data", "ExecuteStatement", {
      sql: { type: "string", required: true, noTrim: true, minLength: 1, maxLength: 200000,
        validator: (v) => (v.trim().length > 0 && Buffer.byteLength(v, "utf8") <= 200000) || "Enter SQL of at most 200000 UTF-8 bytes." },
      clientToken: { ...text, required: true, maxLength: 64 },
      parameters: { type: "array", validator: (v) => (v.length >= 1 && v.length <= 100) || "Supply between 1 and 100 SQL parameters, or omit parameters.", items: { type: "object", schema: createSchema({
        name: { type: "string", required: true, pattern: "^[a-zA-Z0-9_]+$" }, value: { ...text, required: true, maxLength: 65536 }
      }) } }
    }, (v, s) => {
      if (v.parameters && new Set(v.parameters.map((p) => p.name)).size !== v.parameters.length) throw new ConnectorError("connector_input_invalid", "Use each SQL parameter name only once.", { statusCode: 422 });
      return { input: { ...target(s), Sql: v.sql, ClientToken: v.clientToken, ResultFormat: "JSON", ...(v.parameters ? { Parameters: v.parameters } : {}) } };
    }, validId),
    "query.status": awsOperation("redshift-data", "DescribeStatement", { statementId }, (v) => ({ input: { Id: v.statementId } }), validStatement),
    "query.results": awsOperation("redshift-data", "GetStatementResult", { statementId, nextToken },
      (v) => ({ input: { Id: v.statementId, ...(v.nextToken ? { NextToken: v.nextToken } : {}) } }),
      (r) => validColumns(r?.ColumnMetadata) && Array.isArray(r.Records) && r.Records.every((row) => Array.isArray(row) && row.length === r.ColumnMetadata.length && row.every(validCell)) &&
        (r.TotalNumRows === undefined || Number.isSafeInteger(r.TotalNumRows) && r.TotalNumRows >= 0) && hasCursor(r)),
    "query.cancel": awsOperation("redshift-data", "CancelStatement", { statementId }, (v) => ({ input: { Id: v.statementId } }), (r) => typeof r?.Status === "boolean")
  }
});

export { amazonRedshiftProvider };
