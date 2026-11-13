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

/**
 * A handle call on a `system` table in a context that is not a system context: its rows belong to no workspace or user,
 * so a request's context, or one derived for a workspace or a user, would reach every workspace's rows. Nothing runs.
 */
class SystemContextRequiredError extends TypeError {
  /** @param {string} resourceName */
  constructor(resourceName) {
    super(
      `${resourceName} rows belong to no workspace or user (ownership "system"), so only a system context reaches them: ` +
        "the background work of the feature that owns the table, with systemContext(reason). A request's context, or one " +
        "forWorkspace, forUser or forWorkspaceUser derived, would reach every workspace's rows. Call the owner's own methods, " +
        "which run in its system context."
    );
    this.name = "SystemContextRequiredError";
    this.code = "RESOURCE_SYSTEM_CONTEXT_REQUIRED";
  }
}

/**
 * A handle call that reads something only some databases have, on one that lacks it, such as changeHorizon() outside
 * PostgreSQL. Nothing runs.
 */
class UnsupportedDatabaseError extends Error {
  /**
   * @param {string} call The call, as `notes.changeHorizon()`.
   * @param {string} reason What the call reads and which databases have it.
   */
  constructor(call, reason) {
    super(`${call} ${reason}`);
    this.name = "UnsupportedDatabaseError";
    this.code = "RESOURCE_DATABASE_UNSUPPORTED";
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

/**
 * queryAll() or queryPages() in a request context reading past the request row limit: the request answers a 400 coded
 * RESOURCE_ROW_LIMIT, with a sentence the client can show in the user's language, instead of a 500.
 */
class RowLimitError extends AppError {
  /**
   * @param {string} resourceName
   * @param {number} rowLimit
   * @param {unknown} [cause]
   * @param {"queryAll" | "queryPages" | "lockPages"} [caller]
   */
  constructor(resourceName, rowLimit, cause, caller = "queryAll") {
    super(
      400,
      `${resourceName}.${caller}() read more than ${rowLimit} rows inside a request. Work over that many rows belongs ` +
        "in a background job: a feature with systemScope, working per workspace with systemContext(reason).forWorkspace(id), " +
        "where queryPages() reads them a page at a time.",
      { cause, code: "RESOURCE_ROW_LIMIT", messageCode: "resource.rowLimit", messageParams: { rowLimit } }
    );
    this.name = "RowLimitError";
  }
}

/**
 * A grouped aggregate() without a page that has more groups than one statement answers: it throws a 400 coded
 * RESOURCE_GROUP_LIMIT, with a sentence the client can show in the user's language, rather than answer part of them.
 */
class GroupLimitError extends AppError {
  /**
   * @param {string} resourceName
   * @param {number} groupLimit
   */
  constructor(resourceName, groupLimit) {
    super(
      400,
      `${resourceName}.aggregate() has more than ${groupLimit} groups, the most one statement answers. Read them in pages, ` +
        `page: { size, number } with size up to ${groupLimit} and number from 1, each answering { rows, page }, while ` +
        "page.hasMore, or narrow the filters.",
      { code: "RESOURCE_GROUP_LIMIT", messageCode: "resource.groupLimit", messageParams: { groupLimit } }
    );
    this.name = "GroupLimitError";
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

export {
  DuplicateOwnerError,
  GroupLimitError,
  MissingScopeError,
  PageSizeError,
  RowLimitError,
  StaleRecordError,
  SystemContextRequiredError,
  UnpagedQueryError,
  UnsupportedDatabaseError
};
