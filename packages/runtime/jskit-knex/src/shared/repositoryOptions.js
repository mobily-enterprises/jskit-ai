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

export { resolveQueryOptions, resolveRepoClient, applyForUpdate, parseJsonValue, toDbJson };
