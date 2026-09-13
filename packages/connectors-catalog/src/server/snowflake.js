import { ConnectorError } from "@jskit-ai/connectors-core/server";
import { snowflakeDefinition } from "../shared/snowflake.js";
import { jsonOperation } from "./jsonOperation.js";

const origin = (settings) => new URL(settings.accountUrl).origin;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const database = (value) => object(value) && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 255 &&
  ["owner", "comment", "kind", "created_on"].every((key) => value[key] == null || typeof value[key] === "string");
const nameFilter = { type: "string", minLength: 1, maxLength: 255, noTrim: true };
const databasesList = jsonOperation((settings) => `${origin(settings)}/api/v2/databases`, {
  showLimit: { type: "integer", min: 1, max: 1000, defaultTo: 20 },
  like: nameFilter, startsWith: nameFilter, fromName: nameFilter, history: { type: "boolean", defaultTo: false }
}, (value) => Array.isArray(value) && value.every(database));

const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
const uuidField = { type: "string", required: true, validator: (value) => uuid(value) || "Use a Snowflake UUID." };
const bindings = { type: "object", additionalProperties: true, validator: (value) =>
  Object.keys(value).length <= 100 && Object.entries(value).every(([key, binding]) =>
    /^[1-9][0-9]{0,2}$/u.test(key) && object(binding) && Object.keys(binding).every((name) => ["type", "value"].includes(name)) &&
    ["FIXED", "REAL", "TEXT", "BINARY", "BOOLEAN", "DATE", "TIME", "TIMESTAMP_LTZ", "TIMESTAMP_NTZ", "TIMESTAMP_TZ"].includes(binding.type) &&
    (binding.value === null || (typeof binding.value === "string" && binding.value.length <= 65536))) || "Use at most 100 numbered typed bindings." };
const sqlResult = (value) => object(value) && ["pending", "completed", "cancelled"].includes(value.status);
const submit = jsonOperation((settings) => `${origin(settings)}/api/v2/statements`, {
  statement: { type: "string", required: true, minLength: 1, maxLength: 65536, noTrim: true },
  requestId: uuidField, bindings, timeout: { type: "integer", min: 1, max: 3600, defaultTo: 60 }
}, sqlResult, "POST");
const operations = { "databases.list": databasesList,
  "statements.submit": { ...submit, request(input, settings) {
    const request = submit.request(input, settings);
    const { requestId, ...body } = request.body;
    for (const name of ["warehouse", "database", "schema", "role"]) if (settings[name]) body[name] = settings[name];
    body.parameters = { multi_statement_count: "1" };
    return { ...request, url: `${request.url}?async=true&requestId=${requestId}`, body };
  } }
};
for (const [operation, cancel] of [["statements.get", false], ["statements.cancel", true]]) {
  const base = jsonOperation((settings) => `${origin(settings)}/api/v2/statements`, {
    handle: uuidField, ...(!cancel ? { partition: { type: "integer", min: 0, max: 100000 } } : {})
  }, sqlResult, "POST");
  operations[operation] = { ...base, request(input, settings) {
    const { url, body } = base.request(input, settings);
    return { method: cancel ? "POST" : "GET", url: `${url}/${body.handle}${cancel ? "/cancel" : body.partition === undefined ? "" : `?partition=${body.partition}`}`,
      ...(cancel ? { body: {} } : {}) };
  } };
}
for (const action of ["create", "resize", "resume", "suspend", "delete"]) {
  const fields = { name: { ...nameFilter, required: true }, requestId: uuidField };
  if (["create", "resize"].includes(action)) fields.size = { type: "string", required: true,
    enum: ["XSMALL", "SMALL", "MEDIUM", "LARGE", "XLARGE", "XXLARGE", "XXXLARGE", "X4LARGE", "X5LARGE", "X6LARGE"] };
  const base = jsonOperation((settings) => `${origin(settings)}/api/v2/statements`, fields, sqlResult, "POST");
  operations[`warehouses.${action}`] = { ...base, request(input, settings) {
    const { body } = base.request(input, settings);
    const name = `"${body.name.replaceAll('"', '""')}"`;
    const statement = action === "create"
      ? `CREATE WAREHOUSE ${name} WAREHOUSE_SIZE = ${body.size} INITIALLY_SUSPENDED = TRUE AUTO_SUSPEND = 60 AUTO_RESUME = FALSE`
      : action === "resize" ? `ALTER WAREHOUSE ${name} SET WAREHOUSE_SIZE = ${body.size}`
      : action === "delete" ? `DROP WAREHOUSE ${name}`
      : `ALTER WAREHOUSE ${name} ${action === "resume" ? "RESUME IF SUSPENDED" : "SUSPEND"}`;
    return operations["statements.submit"].request({ statement, requestId: body.requestId }, settings);
  } };
}
for (const [name, operation] of Object.entries(operations)) {
  operations[name] = { ...operation, request(input, settings) {
    return { ...operation.request(input, settings), headers: { "X-Snowflake-Authorization-Token-Type": "OAUTH",
      "User-Agent": "jskit-connectors/0.1", ...(settings.role ? { "X-Snowflake-Role": `"${settings.role}"` } : {}) } };
  } };
}

const snowflakeProvider = Object.freeze({
  ...snowflakeDefinition,
  oauth: (settings) => ({ issuer: origin(settings), authorization_endpoint: `${origin(settings)}/oauth/authorize`,
    token_endpoint: `${origin(settings)}/oauth/token-request` }),
  apiOrigins: (settings) => [origin(settings)], checkOperation: "databases.list", scopesInAuthorizationResponse: true,
  async normalizeTokenResponse(response) {
    if (response.ok) {
      let value;
      try { value = await response.clone().json(); } catch { /* rejected below */ }
      if (!Number.isSafeInteger(value?.expires_in) || value.expires_in <= 0 ||
        (value.scope !== undefined && (typeof value.scope !== "string" || !/^[^\s]+(?: [^\s]+)*$/u.test(value.scope))) ||
        (value.refresh_token !== undefined && (typeof value.refresh_token !== "string" || !value.refresh_token.trim()))) {
        throw new ConnectorError("connector_response_invalid", "Snowflake returned an invalid token grant.", { statusCode: 502 });
      }
    }
    return response;
  },
  operations,
  async exchange(address, options, { fetchImpl }) {
    const response = await fetchImpl(address, { ...options, credentials: "omit",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body), headers: { ...options.headers, "Content-Type": "application/json" } } : {}) });
    const url = new URL(address);
    const sql = url.pathname.startsWith("/api/v2/statements");
    if (sql && response.status === 422) throw new ConnectorError("connector_operation_rejected", "Snowflake rejected the statement. Inspect query history with the authorized role.", { statusCode: 422 });
    if (!response.ok) throw Object.assign(new Error("Snowflake request failed."), { status: response.status });
    const reader = response.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new ConnectorError("connector_response_too_large", "Snowflake response exceeds 16 MiB. Reduce the query result or use a native streaming client.", { statusCode: 413 });
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let result;
    try { result = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* rejected below */ }
    if (sql) {
      const reject = () => { throw new ConnectorError("connector_response_invalid", "Snowflake returned an invalid statement response.", { statusCode: 502 }); };
      if (!object(result)) reject();
      const requestedHandle = url.pathname.split("/")[4];
      const handle = result.statementHandle ?? requestedHandle;
      if (!uuid(handle) || (requestedHandle && requestedHandle !== handle)) reject();
      if (response.status === 202 && result.code === "333334") return { status: "pending", handle };
      if (response.status !== 200) reject();
      if (url.pathname.endsWith("/cancel")) {
        if (result.code !== "000604") reject();
        return { status: "cancelled", handle };
      }
      if (result.code !== undefined && !["090001", "391908"].includes(result.code)) reject();
      if (!Array.isArray(result.data) || !result.data.every((row) => Array.isArray(row) && row.every((cell) => cell === null || typeof cell === "string"))) reject();
      const metadata = result.resultSetMetaData;
      if (metadata !== undefined && (!object(metadata) || !Array.isArray(metadata.rowType) ||
        !metadata.rowType.every((column) => object(column) && typeof column.name === "string" && typeof column.type === "string") ||
        !result.data.every((row) => row.length === metadata.rowType.length))) reject();
      if (metadata === undefined && !url.searchParams.has("partition")) reject();
      return { status: "completed", handle, data: result.data, ...(metadata ? { metadata } : {}),
        ...(url.searchParams.has("partition") ? { partition: Number(url.searchParams.get("partition")) } : {}) };
    }
    if (response.status !== 200 || !Array.isArray(result) || result.length > Number(url.searchParams.get("showLimit"))) {
      throw new ConnectorError("connector_response_invalid", "Snowflake returned an unexpected database page.", { statusCode: 502 });
    }
    return result;
  }
});
export { snowflakeProvider };
