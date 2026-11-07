import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

// The resource runtime's own refusals. json-rest-api's errors (RestApiRecordsNotFoundError,
// RestApiBulkWriteUnsupportedError, RestApiLockOutsideTransactionError, RestApiScopedQueryReadOnlyError,
// RestApiWriteError and the others) reach the caller as json-rest-api throws them.

/** A handle call on an owned resource without the caller's context: ownership cannot be applied, so nothing runs. */
class MissingScopeError extends TypeError {
  /**
   * @param {string} resourceName
   * @param {"workspace" | "user"} [owner] The owner the table's rows belong to, when the context names none.
   */
  constructor(resourceName, owner) {
    super(
      (owner
        ? `${resourceName} rows each belong to a ${owner}, and this context names no ${owner}, so the ownership scope cannot be applied. `
        : `${resourceName} needs options.context, so the ownership scope can be applied. `) +
        "Pass on the options your function received. Only a background job of a feature with systemScope uses " +
        "systemContext(reason).forWorkspace(id); never use it to make a request work."
    );
    this.name = "MissingScopeError";
    this.code = "RESOURCE_MISSING_SCOPE";
  }
}

/** query() without page.size: every list is paged, and every-row reads say so with queryAll(). */
class UnpagedQueryError extends TypeError {
  /** @param {string} resourceName */
  constructor(resourceName) {
    super(`${resourceName}.query() needs page.size; read every row with queryAll(), count with aggregate().`);
    this.name = "UnpagedQueryError";
    this.code = "RESOURCE_UNPAGED_QUERY";
  }
}

/** query() asking for a page larger than the resource serves. */
class PageSizeError extends TypeError {
  /**
   * @param {string} resourceName
   * @param {unknown} size
   * @param {number} limit
   */
  constructor(resourceName, size, limit) {
    super(
      `${resourceName}.query() page.size ${size} is above the resource's page limit (${limit}), so it would return ` +
        `only ${limit} records. Read every row with queryAll(), or page with page.after.`
    );
    this.name = "PageSizeError";
    this.code = "RESOURCE_PAGE_SIZE";
  }
}

/** queryAll() in a request context reading past the request row limit. */
class RowLimitError extends Error {
  /**
   * @param {string} resourceName
   * @param {number} rowLimit
   * @param {unknown} cause
   */
  constructor(resourceName, rowLimit, cause) {
    super(
      `${resourceName}.queryAll() read more than ${rowLimit} rows inside a request. Work over that many rows belongs ` +
        "in a background job: a feature with systemScope, working per workspace with systemContext(reason).forWorkspace(id).",
      { cause }
    );
    this.name = "RowLimitError";
    this.code = "RESOURCE_ROW_LIMIT";
  }
}

/** patch() with lockVersion on a record someone else changed since it was read. */
class StaleRecordError extends AppError {
  constructor() {
    super(409, "This record changed. Reload and try again.", {
      code: "crud.document.lockVersionConflict"
    });
    this.name = "StaleRecordError";
  }
}

/** own() for a table or resource name another feature already owns. */
class DuplicateOwnerError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "DuplicateOwnerError";
    this.code = "RESOURCE_DUPLICATE_OWNER";
  }
}

export { DuplicateOwnerError, MissingScopeError, PageSizeError, RowLimitError, StaleRecordError, UnpagedQueryError };
