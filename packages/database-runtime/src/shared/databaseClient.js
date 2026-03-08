function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDatabaseClient(value, { allowEmpty = false } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    if (allowEmpty) {
      return "";
    }
    throw new Error("DB_CLIENT is required. Use mysql2 or pg.");
  }

  if (normalized === "pg") {
    return "pg";
  }

  if (normalized === "mysql2") {
    return "mysql2";
  }

  throw new Error(`Unsupported DB_CLIENT "${normalized}". Use one of: mysql2, pg.`);
}

function toKnexClientId(databaseClient) {
  return normalizeDatabaseClient(databaseClient);
}

export {
  normalizeText,
  normalizeDatabaseClient,
  toKnexClientId
};
