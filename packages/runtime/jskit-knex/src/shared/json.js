import { detectDialectFromClient } from "./dialect.js";

function normalizePath(path) {
  if (Array.isArray(path)) {
    return path.map((part) => String(part || "").trim()).filter(Boolean);
  }

  const source = String(path || "").trim();
  if (!source) {
    return [];
  }

  return source
    .split(".")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function jsonTextExpression({ client, column, path }) {
  const normalizedPath = normalizePath(path);
  if (!column || normalizedPath.length < 1) {
    throw new TypeError("jsonTextExpression requires column and path.");
  }

  const dialect = detectDialectFromClient(client);
  if (dialect === "postgres") {
    const pgPath = normalizedPath.map((part) => part.replace(/[{}]/g, "")).join(",");
    return client.raw("?? #>> ?", [column, `{${pgPath}}`]);
  }

  const mysqlPath = `$.${normalizedPath.join(".")}`;
  return client.raw("JSON_UNQUOTE(JSON_EXTRACT(??, ?))", [column, mysqlPath]);
}

function whereJsonTextEquals(query, { column, path, value }) {
  const expression = jsonTextExpression({ client: query.client, column, path });
  query.whereRaw(`${expression.sql} = ?`, [...expression.bindings, String(value || "")]);
  return query;
}

export { normalizePath, jsonTextExpression, whereJsonTextEquals };
