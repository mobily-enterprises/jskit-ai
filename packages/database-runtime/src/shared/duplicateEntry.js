import { detectDialectFromClient, normalizeDialect } from "./dialect.js";

function isMysqlDuplicateEntryError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (code === "ER_DUP_ENTRY") {
    return true;
  }

  const errno = Number(error?.errno || error?.errorno || 0);
  return errno === 1062;
}

function isPostgresDuplicateEntryError(error) {
  const code = String(error?.code || "").trim();
  return code === "23505";
}

function findDuplicateEntryError(error, { dialect = "", client = null } = {}) {
  const resolvedDialect =
    normalizeDialect(dialect) || (client ? normalizeDialect(detectDialectFromClient(client)) : "");
  const seen = new Set();
  let duplicate = null;

  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    let matches;
    if (resolvedDialect === "postgres") {
      matches = isPostgresDuplicateEntryError(error);
    } else if (resolvedDialect === "mysql") {
      matches = isMysqlDuplicateEntryError(error);
    } else {
      matches = isMysqlDuplicateEntryError(error) || isPostgresDuplicateEntryError(error);
    }

    if (matches) {
      // Wrappers may copy driver codes; retain the underlying constraint details.
      duplicate = error;
    }
    error = error.cause;
  }

  return duplicate;
}

function isDuplicateEntryError(error, options) {
  return findDuplicateEntryError(error, options) !== null;
}

export { findDuplicateEntryError, isDuplicateEntryError };
