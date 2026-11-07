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

// better-sqlite3 names the constraint a duplicate broke: a unique index or the primary key.
const SQLITE_DUPLICATE_CODES = Object.freeze(new Set(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"]));

function isSqliteDuplicateEntryError(error) {
  return SQLITE_DUPLICATE_CODES.has(String(error?.code || "").trim().toUpperCase());
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
    } else if (resolvedDialect.includes("sqlite")) {
      matches = isSqliteDuplicateEntryError(error);
    } else {
      matches = isMysqlDuplicateEntryError(error) || isPostgresDuplicateEntryError(error) || isSqliteDuplicateEntryError(error);
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

/**
 * True when an insert lost a race to a concurrent insert of the same row,
 * outside a caller's transaction: the call held no `options.trx`, its own
 * transaction rolled back in full (json-rest-api's `transactionOutcome`), and
 * the error is a duplicate entry. The caller may then read the winner's row.
 * Inside a caller's transaction the failed statement cannot be recovered, so
 * it is never such a race.
 * @param {{ transactionOutcome?: string } | null | undefined} error
 * @param {{ trx?: unknown }} options The insert call's options.
 */
function isLostDuplicateInsertRace(error, options) {
  return !options.trx && error?.transactionOutcome === "rolledBack" && isDuplicateEntryError(error);
}

export { findDuplicateEntryError, isDuplicateEntryError, isLostDuplicateInsertRace };
