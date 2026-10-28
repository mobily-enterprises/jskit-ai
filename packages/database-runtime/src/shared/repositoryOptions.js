import { normalizeCanonicalRecordIdText } from "@jskit-ai/kernel/shared/support/normalize";

function resolveQueryOptions(options = {}) {
  if (!options || typeof options !== "object") {
    return {
      trx: null,
      forUpdate: false
    };
  }

  return {
    trx: options.trx || null,
    forUpdate: options.forUpdate === true
  };
}

function resolveRepoClient(dbClient, options = {}) {
  const { trx } = resolveQueryOptions(options);
  return trx || dbClient;
}

function applyForUpdate(query, options = {}) {
  const { forUpdate } = resolveQueryOptions(options);
  if (forUpdate && typeof query?.forUpdate === "function") {
    return query.forUpdate();
  }

  return query;
}

function parseJsonObject(value, fallback = {}) {
  const source = String(value || "").trim();
  if (!source) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function stringifyJsonObject(value, fallback = "{}") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function normalizeNullableString(value, { trim = true } = {}) {
  if (value == null) {
    return null;
  }

  const source = String(value);
  const normalized = trim ? source.trim() : source;
  return normalized || null;
}

function normalizeDbRecordId(value, { fallback = null } = {}) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "string") {
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      return fallback;
    }
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "bigint") {
    if (value < 1n) {
      return fallback;
    }
    return normalizeCanonicalRecordIdText(value, { fallback });
  }

  if (typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "id")) {
    return normalizeDbRecordId(value.id, { fallback });
  }

  return normalizeCanonicalRecordIdText(value, { fallback });
}

function resolveInsertedRecordId(insertResult, { fallback = null } = {}) {
  if (Array.isArray(insertResult) && insertResult.length > 0) {
    return normalizeDbRecordId(insertResult[0], { fallback });
  }

  return normalizeDbRecordId(insertResult, { fallback });
}

function parseJsonValue(value, fallback = null, options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const effectiveFallback = Object.hasOwn(source, "fallback") ? source.fallback : fallback;
  const allowNull = source.allowNull === true;
  const allowObject = source.allowObject !== false;
  const trim = source.trim !== false;

  if (value == null) {
    return effectiveFallback;
  }

  if (allowObject && typeof value === "object") {
    return value;
  }

  let text = String(value || "");
  if (trim) {
    text = text.trim();
  }

  if (!text) {
    return effectiveFallback;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed == null && !allowNull) {
      return effectiveFallback;
    }
    return parsed;
  } catch {
    return effectiveFallback;
  }
}

function toDbJson(value) {
  if (value == null) {
    return JSON.stringify({});
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

async function runInTransaction(knex, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("runInTransaction requires callback.");
  }
  if (!knex || typeof knex !== "function") {
    throw new TypeError("runInTransaction requires knex client.");
  }

  if (typeof knex.transaction !== "function") {
    return callback(knex);
  }
  return knex.transaction(callback);
}

function createWithTransaction(knex) {
  return function withTransaction(work) {
    return runInTransaction(knex, work);
  };
}

function requireSqlIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(identifier)) {
    throw new TypeError(`${label} must be a safe SQL identifier.`);
  }
  return identifier;
}

async function lockScopedRecordId({
  trx,
  tableName,
  recordId,
  scopeId,
  idColumn = "id",
  scopeColumn = "workspace_id"
} = {}) {
  if (typeof trx !== "function") {
    throw new TypeError("lockScopedRecordId requires a transaction.");
  }
  const table = requireSqlIdentifier(tableName, "lockScopedRecordId tableName");
  const recordKey = requireSqlIdentifier(idColumn, "lockScopedRecordId idColumn");
  const scopeKey = requireSqlIdentifier(scopeColumn, "lockScopedRecordId scopeColumn");
  const normalizedRecordId = normalizeDbRecordId(recordId);
  const normalizedScopeId = normalizeDbRecordId(scopeId);
  if (!normalizedRecordId || !normalizedScopeId) {
    return null;
  }
  const row = await trx(table)
    .select(recordKey)
    .where(recordKey, normalizedRecordId)
    .andWhere(scopeKey, normalizedScopeId)
    .forUpdate()
    .first();
  return normalizeDbRecordId(row?.[recordKey]);
}

export {
  resolveQueryOptions,
  resolveRepoClient,
  applyForUpdate,
  parseJsonObject,
  stringifyJsonObject,
  normalizeNullableString,
  normalizeDbRecordId,
  resolveInsertedRecordId,
  parseJsonValue,
  toDbJson,
  runInTransaction,
  createWithTransaction,
  lockScopedRecordId
};
