import { createSchema } from "json-rest-schema";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { clickhouseDefinition } from "../shared/clickhouse.js";

const name = { type: "string", required: true, minLength: 1, maxLength: 256,
  validator: (value) => !/[\p{Cc}]/u.test(value) || "Use a name without control characters." };
const pagination = {
  limit: { type: "integer", min: 1, max: 100, defaultTo: 20 },
  offset: { type: "integer", min: 0, max: 1000000, defaultTo: 0 }
};

function queryOperation(query, fields, validateData, parameters = values => values) {
  const schema = createSchema(fields);
  return {
    scopes: [],
    request(input, settings) {
      const values = validateSchemaPayload({ schema, mode: "replace" }, input, { statusCode: 422 });
      const url = new URL(settings.httpUrl);
      const sql = typeof query === "function" ? query(values) : query;
      url.searchParams.set("query", `${sql} FORMAT JSON`);
      url.searchParams.set("readonly", "1");
      url.searchParams.set("wait_end_of_query", "1");
      url.searchParams.set("max_execution_time", "10");
      url.searchParams.set("max_result_rows", "100");
      url.searchParams.set("max_result_bytes", "5242880");
      url.searchParams.set("result_overflow_mode", "throw");
      for (const [key, value] of Object.entries(parameters(values))) url.searchParams.set(`param_${key}`, String(value).replaceAll("\\", "\\\\"));
      return { method: "GET", url: url.href };
    },
    validateResult(result) {
      return Boolean(result && !result.exception && !result.error && Array.isArray(result.meta) &&
        result.meta.every((column) => typeof column?.name === "string" && typeof column.type === "string") &&
        Array.isArray(result.data) && result.data.length <= 100 && Number.isInteger(result.rows) && result.rows === result.data.length &&
        result.data.every((row) => row && typeof row === "object" && !Array.isArray(row)) && (!validateData || validateData(result.data)));
    }
  };
}

const clickhouseProvider = Object.freeze({
  ...clickhouseDefinition,
  apiOrigins: (settings) => [new URL(settings.httpUrl).origin],
  apiKey: { headers: (password, settings) => ({ Authorization: `Basic ${Buffer.from(`${settings.username || "default"}:${password}`).toString("base64")}` }) },
  checkOperation: "connection.check",
  operations: {
    "connection.check": queryOperation("SELECT 1 AS ok, currentUser() AS user", {},
      (rows) => rows.length === 1 && rows[0].ok === 1 && typeof rows[0].user === "string" && rows[0].user.length > 0),
    "queries.read": queryOperation(values => values.sql, {
      sql: { type: "string", required: true, minLength: 1, maxLength: 16000,
        // eslint-disable-next-line no-control-regex -- Reject literal control characters in provider input.
        validator: value => /^\s*(SELECT|WITH)\b/iu.test(value) && !/[;\u0000]/u.test(value) || "Use one SELECT/WITH query without a terminating semicolon; pass values as typed parameters." },
      parameters: { type: "object", additionalProperties: true,
        validator: value => Object.keys(value).length <= 100 && Object.entries(value).every(([key, item]) =>
          /^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(key) && typeof item === "string" && item.length <= 16000 && !/[\p{Cc}]/u.test(item)) || "Use up to 100 named string parameters without control characters." }
    }, undefined, values => values.parameters || {}),
    "tables.list": queryOperation((values) => `SELECT database, name, engine FROM system.tables${values.database === undefined ? "" : " WHERE database = {database:String}"} ORDER BY database, name LIMIT {limit:UInt32} OFFSET {offset:UInt64}`,
      { ...pagination, database: { ...name, required: false } },
      (rows) => rows.every((row) => typeof row.database === "string" && typeof row.name === "string" && typeof row.engine === "string")),
    "columns.list": queryOperation("SELECT name, type, position, default_kind, default_expression FROM system.columns WHERE database = {database:String} AND table = {table:String} ORDER BY position LIMIT {limit:UInt32} OFFSET {offset:UInt64}",
      { database: name, table: name, ...pagination },
      (rows) => rows.every((row) => typeof row.name === "string" && typeof row.type === "string")),
    "rows.list": queryOperation((values) => `SELECT * FROM {database:Identifier}.{table:Identifier}${values.orderBy === undefined ? "" : " ORDER BY {orderBy:Identifier}"} LIMIT {limit:UInt32} OFFSET {offset:UInt64}`,
      { database: name, table: name, orderBy: { ...name, required: false }, ...pagination })
  }
});

export { clickhouseProvider };
