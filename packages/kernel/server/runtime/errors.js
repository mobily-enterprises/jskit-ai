import { normalizeObjectInput } from "../../shared/validators/inputNormalization.js";

export class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    /** The values the code's sentence needs ({ min: 8 }), so a client can show the code in the user's language; message stays the English text. */
    this.params = normalizeObjectInput(options.params);
    // A per-sentence code for errors that must keep a shared code callers branch on.
    if (options.messageCode) {
      this.messageCode = String(options.messageCode);
      this.messageParams = normalizeObjectInput(options.messageParams);
    }
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

export class DomainError extends AppError {
  constructor(status, message, options = {}) {
    super(status, message, {
      ...options,
      code: options.code || "domain_error"
    });
    this.name = "DomainError";
  }
}

export class DomainValidationError extends DomainError {
  constructor(details, options = {}) {
    super(422, options.message || "Domain validation failed.", {
      ...options,
      code: options.code || "domain_validation_failed",
      details
    });
    this.name = "DomainValidationError";
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Conflict.", options = {}) {
    super(409, message, {
      ...options,
      code: options.code || "conflict"
    });
    this.name = "ConflictError";
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Not found.", options = {}) {
    super(404, message, {
      ...options,
      code: options.code || "not_found"
    });
    this.name = "NotFoundError";
  }
}

export function isAppError(error) {
  return error instanceof AppError;
}

// The refusals a database makes of a transaction for a concurrent one, after which the same request can be tried
// again: a deadlock, a lock wait that timed out, a row changed since the transaction's snapshot (MariaDB's
// "Record has changed since last read"), a serialization failure, a locked SQLite database.
const CONCURRENCY_CODES = new Set(["ER_CHECKREAD", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "40001", "40P01", "55P03", "SQLITE_BUSY"]);
const CONCURRENCY_ERRNOS = new Set([1020, 1205, 1213]);

// A database driver's own error: MySQL's and MariaDB's (sqlMessage, sqlState, sql, ER_ codes), Postgres's (severity
// and routine) and SQLite's (SQLITE_ codes).
function isDriverError(error) {
  const code = String(error.code ?? "");
  return typeof error.sqlMessage === "string" || typeof error.sqlState === "string" || typeof error.sql === "string" ||
    /^(ER_|SQLITE_)/u.test(code) || (typeof error.severity === "string" && typeof error.routine === "string");
}

function findDatabaseError(error) {
  const seen = new Set();
  // An AppError is an answer the code chose for a client, such as a ConflictError for a duplicate key, whatever it wraps.
  while (error && typeof error === "object" && !seen.has(error) && !(error instanceof AppError)) {
    seen.add(error);
    if (isDriverError(error)) {
      return error;
    }
    error = error.cause;
  }
  return null;
}

/**
 * What a client may be told of an error. A database error, thrown as it is or as the cause of a wrapper that copies
 * its message and code (json-rest-api's RestApiWriteError), carries the statement, its values and the driver's codes,
 * which belong in the server log only: it is answered by a stand-in, a 409 ConflictError coded kernel.database.concurrentWrite
 * when the database refused the transaction for a concurrent one, so the request can be sent again, else a 500
 * AppError coded internal_server_error, with the wrapper's transactionOutcome. Any other error, and an AppError whatever its cause, comes back
 * unchanged.
 * @param {any} error
 * @returns {any}
 */
export function hideDatabaseError(error) {
  const found = findDatabaseError(error);
  if (!found) {
    return error;
  }
  const conflict = CONCURRENCY_CODES.has(String(found.code ?? "").toUpperCase()) || CONCURRENCY_ERRNOS.has(Number(found.errno));
  const shown = conflict
    ? new ConflictError("Another request changed the same data at the same time. Try again.", { code: "kernel.database.concurrentWrite" })
    : new AppError(500, "Internal server error.", { code: "internal_server_error" });
  if (error.transactionOutcome !== undefined) {
    shown.transactionOutcome = error.transactionOutcome;
  }
  return shown;
}

export function isDomainError(error) {
  return error instanceof DomainError;
}

// A field error is an English string or { code, params, message }. fieldErrors
// keeps the English strings; fieldErrorCodes carries the coded entries.
export function createValidationError(fieldErrors) {
  const messages = {};
  const fieldErrorCodes = {};
  for (const [field, entry] of Object.entries(fieldErrors || {})) {
    if (!entry || typeof entry !== "object") {
      messages[field] = entry;
      continue;
    }
    messages[field] = String(entry.message || "");
    if (entry.code) {
      fieldErrorCodes[field] = { code: String(entry.code), params: normalizeObjectInput(entry.params) };
    }
  }
  return new AppError(400, "Validation failed.", {
    code: "validation_failed",
    details: {
      fieldErrors: messages,
      ...(Object.keys(fieldErrorCodes).length ? { fieldErrorCodes } : {})
    }
  });
}
