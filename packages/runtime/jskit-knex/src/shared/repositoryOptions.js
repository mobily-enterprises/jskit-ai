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

function mapRowNullable(mapper) {
  if (typeof mapper !== "function") {
    throw new TypeError("mapRowNullable requires a mapper function.");
  }

  return function mapNullableRow(row) {
    if (!row) {
      return null;
    }
    return mapper(row);
  };
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

function normalizeCountRow(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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

export {
  resolveQueryOptions,
  resolveRepoClient,
  applyForUpdate,
  mapRowNullable,
  parseJsonObject,
  stringifyJsonObject,
  normalizeCountRow,
  parseJsonValue,
  toDbJson
};
