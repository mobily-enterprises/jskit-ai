import { db } from "../../../../db/knex.js";
import { toIsoString, toMysqlDateTimeUtc } from "../../../lib/primitives/dateUtils.js";

function parseMetadata(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function mapBrowserErrorRowRequired(row) {
  if (!row) {
    throw new TypeError("mapBrowserErrorRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    createdAt: toIsoString(row.created_at),
    occurredAt: row.occurred_at ? toIsoString(row.occurred_at) : "",
    source: String(row.source || ""),
    errorName: String(row.error_name || ""),
    message: String(row.message || ""),
    stack: String(row.stack || ""),
    url: String(row.url || ""),
    path: String(row.path || ""),
    surface: String(row.surface || ""),
    userAgent: String(row.user_agent || ""),
    lineNumber: row.line_number == null ? null : Number(row.line_number),
    columnNumber: row.column_number == null ? null : Number(row.column_number),
    userId: row.user_id == null ? null : Number(row.user_id),
    username: String(row.username || ""),
    metadata: parseMetadata(row.metadata_json)
  };
}

function mapServerErrorRowRequired(row) {
  if (!row) {
    throw new TypeError("mapServerErrorRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    createdAt: toIsoString(row.created_at),
    requestId: String(row.request_id || ""),
    method: String(row.method || ""),
    path: String(row.path || ""),
    statusCode: Number(row.status_code || 500),
    errorName: String(row.error_name || ""),
    message: String(row.message || ""),
    stack: String(row.stack || ""),
    userId: row.user_id == null ? null : Number(row.user_id),
    username: String(row.username || ""),
    metadata: parseMetadata(row.metadata_json)
  };
}

function normalizeCount(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function stringifyMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return "{}";
  }

  try {
    return JSON.stringify(metadata);
  } catch {
    return "{}";
  }
}

function createErrorLogsRepository(dbClient) {
  function resolveClient(options = {}) {
    const trx = options && typeof options === "object" ? options.trx || null : null;
    return trx || dbClient;
  }

  async function repoInsertBrowserError(entry, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("console_browser_errors").insert({
      created_at: toMysqlDateTimeUtc(now),
      occurred_at: entry.occurredAt ? toMysqlDateTimeUtc(new Date(entry.occurredAt)) : null,
      source: String(entry.source || "").trim(),
      error_name: String(entry.errorName || "").trim(),
      message: String(entry.message || "").trim(),
      stack: String(entry.stack || ""),
      url: String(entry.url || ""),
      path: String(entry.path || ""),
      surface: String(entry.surface || ""),
      user_agent: String(entry.userAgent || ""),
      line_number: entry.lineNumber == null ? null : Number(entry.lineNumber),
      column_number: entry.columnNumber == null ? null : Number(entry.columnNumber),
      user_id: entry.userId == null ? null : Number(entry.userId),
      username: String(entry.username || ""),
      metadata_json: stringifyMetadata(entry.metadata)
    });

    const row = await client("console_browser_errors").where({ id }).first();
    return mapBrowserErrorRowRequired(row);
  }

  async function repoCountBrowserErrors(options = {}) {
    const client = resolveClient(options);
    const row = await client("console_browser_errors").count({ total: "*" }).first();
    return normalizeCount(row);
  }

  async function repoListBrowserErrors(page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const rows = await client("console_browser_errors")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapBrowserErrorRowRequired);
  }

  async function repoGetBrowserErrorById(errorId, options = {}) {
    const client = resolveClient(options);
    const row = await client("console_browser_errors").where({ id: Number(errorId) }).first();
    if (!row) {
      return null;
    }

    return mapBrowserErrorRowRequired(row);
  }

  async function repoInsertServerError(entry, options = {}) {
    const client = resolveClient(options);
    const now = new Date();
    const [id] = await client("console_server_errors").insert({
      created_at: toMysqlDateTimeUtc(now),
      request_id: String(entry.requestId || ""),
      method: String(entry.method || ""),
      path: String(entry.path || ""),
      status_code: Number(entry.statusCode || 500),
      error_name: String(entry.errorName || ""),
      message: String(entry.message || ""),
      stack: String(entry.stack || ""),
      user_id: entry.userId == null ? null : Number(entry.userId),
      username: String(entry.username || ""),
      metadata_json: stringifyMetadata(entry.metadata)
    });

    const row = await client("console_server_errors").where({ id }).first();
    return mapServerErrorRowRequired(row);
  }

  async function repoCountServerErrors(options = {}) {
    const client = resolveClient(options);
    const row = await client("console_server_errors").count({ total: "*" }).first();
    return normalizeCount(row);
  }

  async function repoListServerErrors(page, pageSize, options = {}) {
    const client = resolveClient(options);
    const offset = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const rows = await client("console_server_errors")
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(pageSize)
      .offset(offset);

    return rows.map(mapServerErrorRowRequired);
  }

  async function repoGetServerErrorById(errorId, options = {}) {
    const client = resolveClient(options);
    const row = await client("console_server_errors").where({ id: Number(errorId) }).first();
    if (!row) {
      return null;
    }

    return mapServerErrorRowRequired(row);
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }

    return callback(dbClient);
  }

  return {
    insertBrowserError: repoInsertBrowserError,
    countBrowserErrors: repoCountBrowserErrors,
    listBrowserErrors: repoListBrowserErrors,
    getBrowserErrorById: repoGetBrowserErrorById,
    insertServerError: repoInsertServerError,
    countServerErrors: repoCountServerErrors,
    listServerErrors: repoListServerErrors,
    getServerErrorById: repoGetServerErrorById,
    transaction: repoTransaction
  };
}

const repository = createErrorLogsRepository(db);

const __testables = {
  parseMetadata,
  mapBrowserErrorRowRequired,
  mapServerErrorRowRequired,
  normalizeCount,
  stringifyMetadata,
  createErrorLogsRepository
};

export const {
  insertBrowserError,
  countBrowserErrors,
  listBrowserErrors,
  getBrowserErrorById,
  insertServerError,
  countServerErrors,
  listServerErrors,
  getServerErrorById,
  transaction
} = repository;
export { __testables };
