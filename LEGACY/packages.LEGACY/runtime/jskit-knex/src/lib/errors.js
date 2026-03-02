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

function isDuplicateEntryError(error, { dialect = "", client = null } = {}) {
  if (!error) {
    return false;
  }

  const resolvedDialect =
    normalizeDialect(dialect) || (client ? normalizeDialect(detectDialectFromClient(client)) : "");

  if (resolvedDialect === "postgres") {
    return isPostgresDuplicateEntryError(error);
  }

  if (resolvedDialect === "mysql") {
    return isMysqlDuplicateEntryError(error);
  }

  return isMysqlDuplicateEntryError(error) || isPostgresDuplicateEntryError(error);
}

export { isDuplicateEntryError };
