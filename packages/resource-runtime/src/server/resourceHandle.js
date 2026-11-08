import diagnosticsChannel from "node:diagnostics_channel";
import { RestApiRowLimitError } from "json-rest-api";
import { retryDeadlocks } from "@jskit-ai/database-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { createJsonRestContext, isJobContext } from "./contexts.js";
import { createLockReads } from "./handleLocks.js";
import { findOrCreateRecord, lockOrCreate } from "./lockOrCreate.js";
import { MissingScopeError, PageSizeError, RowLimitError, StaleRecordError, UnpagedQueryError } from "./errors.js";
import {
  formatOf, matchesNoRow, missingOf, requireConditionValues, requireDefinedFilters, requireOwners, requirePatchConditions, requireReadParams, requireUpsertRows,
  valueOnly, whereSelection
} from "./handleGuards.js";
import {
  aggregateMeasures,
  MANY_RETURNING,
  SINGLE_RETURNING,
  handleRecords,
  handleResult,
  idOf,
  inputData,
  manyResult,
  matchesOnlyIf,
  noRowsAggregate,
  patchAnswer,
  pickReturning,
  quietCollections,
  readQueryParams,
  requestedFields,
  textList,
  upsertConflict
} from "./handleRecords.js";
import {
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "./resourceHost.js";

// Each many-row call publishes { resource, operation, rows, chunkSize } here while something
// subscribes, so a flat-query test can tell the statements chunking adds from statements that
// grow with the rows.
const MANY_ROW_CHANNEL = "jskit:resources:many-row";
const DEFAULT_CHUNK_SIZE = 500;

/**
 * Reports one many-row call while a flat-query test listens: its rows and chunk
 * size tell the test how many statements chunking adds, so a call over more rows
 * is not taken for N+1.
 * @param {string} resource
 * @param {string} operation
 * @param {number} rows
 * @param {number | undefined} chunkSize
 */
function reportManyRow(resource, operation, rows, chunkSize) {
  const channel = diagnosticsChannel.channel(MANY_ROW_CHANNEL);
  if (channel.hasSubscribers) {
    channel.publish(Object.freeze({
      resource,
      operation,
      rows,
      chunkSize: chunkSize || DEFAULT_CHUNK_SIZE
    }));
  }
}

// The transactions handles opened: json-rest-api's own, which every handle call inside the work joins.
const handleTransactions = new WeakSet();

// A call's options.trx, read or write, is one a handle's withTransaction opened, never a raw Knex transaction.
function requireHandleTransaction(name, options) {
  if (options.trx && !handleTransactions.has(options.trx)) {
    throw new TypeError(
      `${name}: options.trx is not a transaction a handle opened. A raw Knex transaction or savepoint cannot carry ` +
        "handle calls, reads included: run the work in withTransaction(options, work) and pass on the txOptions it gives work."
    );
  }
}

// Opens a transaction for work. When work throws, json-rest-api rolls the transaction back and the caller gets the
// error work threw, with its status and code, reporting the transaction's outcome ("rolledBack") as transactionOutcome
// (not enumerable, so its serialized form is unchanged; a frozen error cannot carry it): a caller that retries a lost
// race, such as one that turned a duplicate key into its own 409, sees that nothing was written. A failed write inside
// work (an error that reports a transactionOutcome, which said "pending") arrives as json-rest-api's RestApiWriteError,
// which reports the outcome after the rollback, as a failed commit does.
// Errors work threw that a transaction marked with its outcome: an enclosing transaction still passes them on as work's
// own, not as a failed write's.
const outcomeMarked = new WeakSet();

async function openTransaction(api, options, work) {
  let own = null;
  try {
    return await api.transaction(async (trx) => {
      handleTransactions.add(trx);
      try {
        return await work(Object.freeze({ ...options, trx }));
      } catch (error) {
        own = { error };
        throw error;
      }
    });
  } catch (error) {
    if (!own || error?.cause !== own.error || (own.error?.transactionOutcome !== undefined && !outcomeMarked.has(own.error))) {
      throw error;
    }
    if (Object.isExtensible(own.error)) {
      Object.defineProperty(own.error, "transactionOutcome", { value: error.transactionOutcome, configurable: true });
      outcomeMarked.add(own.error);
    }
    throw own.error;
  }
}

// Whether the call runs inside a transaction (`options.trx` is set): the handle's own reader, never handed out.
function inTransaction(options) {
  return Boolean(options.trx);
}

// A write given no transaction owns one, so it is outermost and may run again.
function write(options, run) {
  return inTransaction(options) ? run() : retryDeadlocks(run);
}

/**
 * One owned table's handle: every read and write of the table, each applying
 * the scope of the call's `options.context` (ownership and row policy) and
 * joining `options.trx` when there is one. Handles answer records:
 * `{ id, ...fields }`, relationships as ids and included records nested.
 * `options.format: "jsonapi"` is the CRUD service's HTTP edge, which answers
 * JSON:API documents instead.
 * @param {object} dependencies
 * @param {import("./types.js").RuntimeJsonRestApi} dependencies.api
 * @param {import("@jskit-ai/resource-core/shared/tableResource").TableResource} dependencies.resource
 * @param {{ afterWrite?: (event: { operation: string, ids: string[], options: object }) => unknown }} dependencies.hooks
 * @param {{ requestRowLimit: number, serverPageSize: number }} dependencies.settings
 * @param {(name: string) => (import("@jskit-ai/resource-core/shared/tableResource").TableResource | null)} dependencies.resourceNamed
 *   The application's table resources by name, which shape included records.
 */
function createResourceHandle({ api, resource, hooks, settings, resourceNamed }) {
  const name = resource.name;
  const lockVersionField = resource.lockVersionField || "";
  const quiet = { list: quietCollections(resource, "hydrateOnList"), view: quietCollections(resource, "hydrateOnView") };

  function jsonRest() {
    return api.resources[name];
  }

  /** @param {{ context?: object | null }} options */
  function contextOf(options) {
    requireHandleTransaction(name, options);
    if (!options.context && resource.ownership !== "public") {
      throw new MissingScopeError(name);
    }
    requireOwners(name, resource.ownership, options.context);
    return createJsonRestContext(options.context);
  }

  // The fields a list or a one-record read names (see requestedFields).
  const readFields = (params, kind) => requestedFields(params, quiet[kind], () => jsonRest().vars.schemaInfo);
  // lock, lockMany, lockWhere and claim (see handleLocks.js).
  const { lock, lockMany, lockWhere, claim } = createLockReads({ name, resource, jsonRest, readFields, contextOf });

  /**
   * Runs work in the caller's transaction (`options.trx`), or in one it opens,
   * commits and, when the database aborts it as a deadlock victim, runs again
   * whole, up to three more times (a lock wait timeout is not retried). `work` receives the frozen options
   * it must pass to every call inside. When work throws, the caller gets work's
   * own error; a failed write inside it, or a failed commit, arrives as
   * json-rest-api's RestApiWriteError with the transaction's outcome.
   * Settings ride in options: `{ ...options, retry: false }` runs work once, for
   * work that cannot be repeated (it calls a provider); `{ ...options,
   * outermost: true }` refuses a call inside a transaction, for work that must
   * commit before the caller goes on (mail sent after it, say).
   * @template T
   * @param {{ trx?: object | null, context?: object | null, retry?: boolean, outermost?: boolean }} options
   * @param {(txOptions: Readonly<Record<string, any>>) => Promise<T> | T} work
   * @returns {Promise<T>}
   */
  async function withTransaction(options, work, ...rest) {
    if (rest.length > 0) {
      throw new TypeError(`${name}.withTransaction() takes (options, work); settings ride in options: withTransaction({ ...options, retry: false }, work).`);
    }
    const { retry = true, outermost = false, ...callOptions } = options;
    requireHandleTransaction(name, callOptions);
    if (inTransaction(callOptions)) {
      if (outermost) {
        throw new TypeError(`${name}.withTransaction() outermost work commits before it answers, so it cannot run inside the caller's transaction.`);
      }
      return work(callOptions);
    }
    const run = () => openTransaction(api, callOptions, work);
    return retry ? retryDeadlocks(run) : run();
  }

  // With an afterWrite hook, the write and the hook share one transaction, in the caller's scope.
  async function hooked(operation, options, run, idsOf) {
    if (!hooks.afterWrite) {
      return write(options, () => run(options));
    }
    return withTransaction(options, async (txOptions) => {
      const result = await run(txOptions);
      await hooks.afterWrite({ operation, ids: idsOf(result), options: txOptions });
      return result;
    });
  }

  /** The largest page query() serves, and the page size of every-row reads. */
  function pageLimits() {
    return Object.freeze({
      request: jsonRest().vars.queryMaxLimit,
      server: settings.serverPageSize
    });
  }

  /**
   * One page of the records the filters match: `{ records, page: { size, hasMore, next } }`.
   * `page.size` is required and at most pageLimits().request. A scrolling list
   * passes the previous page's `next` as `page.after`; a numbered page passes
   * `page.number` (from 1), answered as `page: { size, number, hasMore, next }`
   * with `next` the following number. Either costs one statement, with no count.
   * @param {{ filters?: object, sort?: string | string[], include?: string | string[], fields?: string[] | object, page?: { size: number, after?: string, number?: number } }} [params]
   * @param {{ context?: object | null, trx?: object | null, format?: "jsonapi" }} [options]
   */
  async function query(params = {}, options = {}) {
    const format = formatOf(name, options);
    const read = { ...params, fields: readFields(params, "list") };
    const queryParams = readQueryParams(resource, read, { page: true, caller: "query" });
    const size = params.page?.size;
    if (size == null && format !== "jsonapi") {
      throw new UnpagedQueryError(name);
    }
    if (size != null && Number(size) > pageLimits().request) {
      throw new PageSizeError(name, size, pageLimits().request);
    }
    const context = contextOf(options);
    const payload = format !== "jsonapi" && matchesNoRow(params.filters, jsonRest().vars.schemaInfo)
      ? { data: [] }
      : await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().query(
        {
          queryParams,
          transaction: options.trx || undefined,
          format
        },
        context
      ));
    if (format === "jsonapi") {
      return payload;
    }
    const pagination = payload.meta?.pagination;
    const hasMore = pagination?.hasMore === true;
    const number = params.page?.number;
    return Object.freeze({
      records: handleRecords(resource, payload.data, read, resourceNamed),
      page: Object.freeze(number === undefined
        ? { size: Number(size), hasMore, next: hasMore ? pagination.cursor?.next ?? null : null }
        : { size: Number(size), number, hasMore, next: hasMore ? number + 1 : null })
    });
  }

  /**
   * Every record the filters match, read in pages of pageLimits().server rows in
   * id order (or `sort`). In a request it throws past the request row limit;
   * a system context, and the workspace and user contexts it derives, read
   * without one.
   * @param {{ filters?: object, sort?: string | string[], include?: string | string[], fields?: string[] | object }} [params]
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function queryAll(params = {}, options = {}) {
    const context = contextOf(options);
    const rowLimit = isJobContext(options.context) ? undefined : settings.requestRowLimit;
    const read = { ...params, fields: readFields(params, "list") };
    const queryParams = readQueryParams(resource, read, { page: false, caller: "queryAll" });
    try {
      const payload = matchesNoRow(params.filters, jsonRest().vars.schemaInfo)
        ? { data: [] }
        : await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().queryAll(
          {
            queryParams,
            pageSize: settings.serverPageSize,
            ...(rowLimit === undefined ? {} : { rowLimit }),
            transaction: options.trx || undefined,
            format: "plain"
          },
          context
        ));
      return handleRecords(resource, payload.data, read, resourceNamed);
    } catch (error) {
      if (error instanceof RestApiRowLimitError && rowLimit !== undefined) {
        throw new RowLimitError(name, rowLimit, error);
      }
      throw error;
    }
  }

  /**
   * One record. A missing or hidden one throws json-rest-api's not-found error
   * (404 at the HTTP edge), or answers null with `missing: "skip"`.
   * @param {unknown} id
   * @param {{ include?: string | string[], fields?: string[] | object }} [params]
   * @param {{ context?: object | null, trx?: object | null, format?: "jsonapi", missing?: "throw" | "skip" }} [options]
   */
  async function get(id, params = {}, options = {}) {
    requireReadParams(name, params);
    const format = formatOf(name, options);
    const named = { ...params, fields: readFields(params, "view") };
    const read = () => returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().get(
      {
        id,
        queryParams: readQueryParams(resource, named, { page: false, caller: "get" }),
        transaction: options.trx || undefined,
        format
      },
      contextOf(options)
    ));
    const result = missingOf(name, "get", options.missing) === "skip" ? await returnNullWhenJsonRestResourceMissing(read) : await read();
    return result === null ? null : handleResult(resource, result, format, named, resourceNamed);
  }

  /**
   * Totals: `measures` ({ name: { count | countDistinct | sum | avg | min | max: field, where? } })
   * over the filtered rows, grouped by `groupBy` fields or date buckets. Answers the rows.
   * @param {{ measures: object, groupBy?: Array<string | object>, filters?: object, sort?: string[], page?: object }} spec
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function aggregate({ measures, groupBy, filters, sort, page }, options = {}) {
    requireDefinedFilters(name, "aggregate", filters);
    const context = contextOf(options);
    if (matchesNoRow(filters, jsonRest().vars.schemaInfo)) {
      return noRowsAggregate(measures, groupBy);
    }
    const result = await jsonRest().aggregate(
      {
        measures: aggregateMeasures(measures),
        ...(groupBy === undefined ? {} : { groupBy }),
        queryParams: {
          ...(filters === undefined ? {} : { filters }),
          ...(sort === undefined ? {} : { sort: textList(sort) }),
          ...(page === undefined ? {} : { page })
        },
        transaction: options.trx || undefined
      },
      context
    );
    return result.data;
  }

  /**
   * Creates one record, stamping its owner from the context. `options.returning`:
   * "record" (default) reads it back, "id" answers its id, "none" nothing.
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "record" | "id" | "none", format?: "jsonapi" }} [options]
   */
  async function create(attributes, options = {}) {
    const returning = pickReturning(SINGLE_RETURNING, options.returning, "record", `${name}.create()`);
    const format = formatOf(name, options);
    // An afterWrite hook needs the new id, so a create returning nothing still asks for it.
    const askFor = hooks.afterWrite && returning === "none" ? "id" : returning;
    const result = await hooked("create", options, (callOptions) => jsonRest().post(
      {
        data: inputData(resource, attributes, "create", options.context),
        returning: SINGLE_RETURNING[askFor],
        transaction: callOptions.trx || undefined,
        format
      },
      contextOf(callOptions)
    ), (created) => [String(idOf(created, format))]);
    if (returning === "none") {
      return undefined;
    }
    return returning === "id" ? idOf(result, format) : handleResult(resource, result, format);
  }

  /**
   * The record with `attributes.id`, created when it is missing (findOrCreateRecord).
   * @param {{ id: unknown } & Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  function findOrCreate(attributes, options = {}) {
    return findOrCreateRecord({ get, create }, attributes, options);
  }

  // One row's UPDATE, where a missing or hidden row throws. An empty patch reads the record instead, unless it moves
  // the lock version on: a lockVersion patch always writes.
  async function patchRecord(id, attributes, options, returning, { advance = false } = {}) {
    if (Object.keys(attributes).length < 1 && !advance) {
      return patchAnswer(id, await get(id, {}, options), returning);
    }
    const result = await hooked("patch", options, (callOptions) => jsonRest().patch(
      {
        id,
        data: inputData(resource, attributes, "update", options.context),
        returning: SINGLE_RETURNING[returning],
        transaction: callOptions.trx || undefined,
        format: formatOf(name, callOptions)
      },
      contextOf(callOptions)
    ), () => [String(id)]);
    return patchAnswer(id, returning === "record" ? handleResult(resource, result, formatOf(name, options)) : undefined, returning);
  }

  // patch() with missing: "skip": one UPDATE that carries the scope (and onlyIf), so a missing, hidden or changed row
  // is left alone, answers null and fails no transaction.
  async function patchIfPresent(id, attributes, options, returning, onlyIf) {
    if (formatOf(name, options) === "jsonapi") {
      throw new TypeError(`${name}.patch() with missing: "skip" answers records, not JSON:API documents.`);
    }
    if (Object.keys(attributes).length < 1) {
      const current = await get(id, {}, { ...options, missing: "skip" });
      return current && (onlyIf === undefined || matchesOnlyIf(current, onlyIf)) ? patchAnswer(id, current, returning) : null;
    }
    const full = returning === "record";
    const result = await hooked("patch", options, (callOptions) => jsonRest().patchMany(
      {
        data: [{ id, ...inputData(resource, attributes, "update", options.context) }],
        missing: "skip",
        ...(onlyIf === undefined ? {} : { onlyIf }),
        returning: full ? "full" : "minimal",
        transaction: callOptions.trx || undefined,
        ...(full ? { format: "plain" } : {})
      },
      contextOf(callOptions)
    ), (written) => manyResult(resource, written, "ids"));
    const [row] = manyResult(resource, result, full ? "records" : "ids");
    return row === undefined ? null : patchAnswer(id, row, returning);
  }

  /**
   * Patches one record and answers it (`returning`: "record", "id" or "none").
   * A missing or hidden record throws json-rest-api's not-found error (404 at
   * the HTTP edge); with `missing: "skip"` it answers null, in one UPDATE that
   * fails no transaction. `lockVersion` patches only while the record's
   * lockVersionField still holds it (StaleRecordError, 409, otherwise), locking
   * the row first; the lock version advances on every update. `onlyIf: { field:
   * value }` patches only while the stored values still equal these, and
   * answers null otherwise.
   * @param {unknown} id
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "record" | "id" | "none", lockVersion?: number, onlyIf?: Record<string, unknown>, missing?: "throw" | "skip", format?: "jsonapi" }} [options]
   */
  async function patch(id, attributes, options = {}) {
    if (!isRecord(attributes)) {
      throw new TypeError(`${name}.patch() takes attributes as an object.`);
    }
    requirePatchConditions(name, lockVersionField, attributes, options);
    const { lockVersion, onlyIf, missing: missingOption, ...callOptions } = options;
    const missing = missingOf(name, "patch", missingOption);
    const returning = pickReturning(SINGLE_RETURNING, callOptions.returning, "record", `${name}.patch()`);
    if (lockVersion === undefined && missing === "skip") {
      return patchIfPresent(id, attributes, callOptions, returning, onlyIf);
    }
    if (lockVersion === undefined && onlyIf === undefined) {
      return patchRecord(id, attributes, callOptions, returning);
    }
    // A missing row throws, so the row's lock comes first, reading only the fields it compares; an UPDATE that changes
    // fields compares onlyIf itself, so a hidden field, which no read answers, is compared too.
    const compared = [...(lockVersion === undefined ? [] : [lockVersionField]), ...Object.keys(onlyIf ?? {})];
    return withTransaction(callOptions, async (txOptions) => {
      const [current] = await lockMany([id], { ...txOptions, missing, fields: compared });
      if (!current) {
        return null;
      }
      if (lockVersion !== undefined && Number(current[lockVersionField]) !== lockVersion) {
        throw new StaleRecordError();
      }
      if (onlyIf !== undefined && Object.keys(attributes).length > 0) {
        return patchIfPresent(id, attributes, txOptions, returning, onlyIf);
      }
      if (onlyIf !== undefined && !matchesOnlyIf(current, onlyIf)) {
        return null;
      }
      return patchRecord(id, attributes, txOptions, returning, { advance: lockVersion !== undefined });
    });
  }

  /**
   * Deletes one record and answers its id. A missing or hidden record throws
   * json-rest-api's not-found error; with `missing: "skip"` it answers null, in
   * one DELETE that fails no transaction.
   * @param {unknown} id
   * @param {{ context?: object | null, trx?: object | null, missing?: "throw" | "skip" }} [options]
   */
  async function deleteRecord(id, options = {}) {
    const { missing: missingOption, ...callOptions } = options;
    if (missingOf(name, "delete", missingOption) === "skip") {
      const deleted = await hooked("delete", callOptions, (txOptions) => jsonRest().deleteMany(
        { ids: [id], missing: "skip", returning: "minimal", transaction: txOptions.trx || undefined },
        contextOf(txOptions)
      ), (result) => manyResult(resource, result, "ids"));
      return manyResult(resource, deleted, "ids").length > 0 ? id : null;
    }
    await hooked("delete", callOptions, (txOptions) => jsonRest().delete(
      {
        id,
        returning: "none",
        transaction: txOptions.trx || undefined,
        format: formatOf(name, txOptions)
      },
      contextOf(txOptions)
    ), () => [String(id)]);
    return id;
  }

  function manyRowWrite(operation, rows, options, request) {
    const returning = pickReturning(MANY_RETURNING, options.returning, "none", `${name}.${operation}()`);
    const askFor = hooks.afterWrite && (returning === "none" || returning === "count") ? "ids" : returning;
    reportManyRow(name, operation, rows, options.chunkSize);
    return hooked(operation, options, (callOptions) => request(
      {
        returning: MANY_RETURNING[askFor],
        ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
        transaction: callOptions.trx || undefined,
        ...(askFor === "records" ? { format: "plain" } : {})
      },
      contextOf(callOptions)
    ), (result) => manyResult(resource, result, "ids")).then((result) => manyResult(resource, result, returning));
  }

  /**
   * Creates every row with one INSERT per chunk, all or nothing. `onConflict:
   * { keys, action: "ignore" | "merge", merge? }` upserts; the keys must include
   * the ownership fields, and merge is refused under a row policy. A table with
   * no owners and no row policy may key it on the id alone (`keys: ["id"]`).
   * `returning`: "none" (default), "ids", "records" or "count".
   * @param {Array<Record<string, unknown>>} rows
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records" | "count", onConflict?: object, chunkSize?: number }} [options]
   */
  async function createMany(rows, options = {}) {
    if (!Array.isArray(rows)) {
      throw new TypeError(`${name}.createMany() takes an array of rows.`);
    }
    if (options.onConflict) {
      requireUpsertRows(name, rows, options.onConflict, resource.idProperty);
    }
    return manyRowWrite("createMany", rows.length, options, (params, context) => jsonRest().postMany(
      { ...params, data: rows.map((row) => inputData(resource, row, "create", options.context)),
        ...(options.onConflict ? { onConflict: upsertConflict(resource, rows, options.onConflict, options.context, jsonRest().vars.schemaInfo.ownershipFields ?? []) } : {}) },
      context
    ));
  }

  /**
   * Patches each row's own changes into the record with its id: `[{ id, ...changes }]`,
   * one UPDATE per chunk. Ids the caller cannot see throw unless `missing: "skip"`;
   * `onlyIf` changes only rows whose stored values still equal it.
   * @param {Array<Record<string, unknown> & { id: unknown }>} rows
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records", onlyIf?: object, missing?: "throw" | "skip", chunkSize?: number }} [options]
   */
  async function patchMany(rows, options = {}) {
    if (!Array.isArray(rows)) {
      throw new TypeError(`${name}.patchMany() takes an array of { id, ...changes } rows.`);
    }
    requireConditionValues(name, "patchMany", options, ["onlyIf"]);
    return manyRowWrite("patchMany", rows.length, options, (params, context) => jsonRest().patchMany(
      {
        ...params,
        data: rows.map(({ id, ...changes }) => ({ id, ...inputData(resource, changes, "update", options.context) })),
        ...(options.onlyIf ? { onlyIf: options.onlyIf } : {}),
        ...(options.missing ? { missing: options.missing } : {})
      },
      context
    ));
  }

  /**
   * The same changes to every record the filters select (the caller's own rows only), in one statement
   * that carries the scope and filters, so a row gone meanwhile is skipped. Empty filters change every
   * row the caller owns, so they need `all: true`. `returning: "count"` answers how many changed.
   * @param {object} filters
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records" | "count", onlyIf?: object, all?: boolean, chunkSize?: number }} [options]
   */
  async function patchWhere(filters, attributes, options = {}) {
    requireConditionValues(name, "patchWhere", options, ["onlyIf"]);
    const selection = whereSelection(name, "patchWhere", filters, options);
    return manyRowWrite("patchWhere", 0, options, (params, context) => jsonRest().patchWhere(
      { ...params, ...selection, data: inputData(resource, attributes, "update", options.context),
        ...(options.onlyIf ? { onlyIf: options.onlyIf } : {}) },
      context
    ));
  }

  /**
   * Deletes every record the filters select (the caller's own rows only), as patchWhere selects them.
   * Empty filters delete every row the caller owns, so they need `all: true`. `returning: "count"`
   * answers how many it deleted, with no ids read back.
   * @param {object} filters
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "count", all?: boolean, chunkSize?: number }} [options]
   */
  async function deleteWhere(filters, options = {}) {
    if (options.returning === "records") {
      throw new TypeError(`${name}.deleteWhere() returning is "none", "ids" or "count".`);
    }
    const selection = whereSelection(name, "deleteWhere", filters, options);
    return manyRowWrite("deleteWhere", 0, options, ({ format: _format, ...params }, context) => jsonRest().deleteWhere(
      { ...params, ...selection },
      context
    ));
  }

  // Runs work on the record with row.id, locked, creating it first when missing (see lockOrCreate.js).
  function lockOrCreateRecord(row, options, work) {
    return lockOrCreate({ name, withTransaction, lock, createMany }, row, options, work);
  }

  /**
   * `{ query }`: a SELECT-only Knex builder on the table, with ownership, the row
   * policy and the filters applied, for a report the resource cannot express.
   * (A builder is thenable, so it comes wrapped.) `purpose` is "report" (default),
   * "bulk-write", "lock" or "claim".
   * @param {{ filters?: object, alias?: string, purpose?: string }} [params]
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function scopedQuery(params = {}, options = {}) {
    requireDefinedFilters(name, "scopedQuery", params.filters);
    return jsonRest().scopedQuery({ ...params, transaction: options.trx || undefined }, contextOf(options));
  }

  /**
   * A field's storage column, qualified by the table or the given alias.
   * @param {string} field
   * @param {string} [alias]
   */
  function column(field, alias = resource.tableName) {
    const adapter = api.knex.helpers.getStorageAdapter(name);
    const storageColumn = field === "id" ? adapter.getIdColumn() : adapter.translateColumn(field);
    return alias ? `${alias}.${storageColumn}` : storageColumn;
  }

  /**
   * One SQL expression for a scoped query or a write's value: a literal string,
   * with its values (and its identifiers, as `??` with column()) given as
   * bindings. It is a value only: awaiting it, or running it any other way, throws.
   * @param {string} sql
   * @param {unknown[]} [bindings]
   */
  function raw(sql, bindings) {
    if (typeof sql !== "string" || !sql.trim()) {
      throw new TypeError(`${name}.raw() takes one SQL expression as a string.`);
    }
    if (/\?/u.test(sql) && !Array.isArray(bindings)) {
      throw new TypeError(`${name}.raw() needs the bindings of its placeholders.`);
    }
    return valueOnly(name, api.knex.instance.raw(sql, bindings || []));
  }

  return Object.freeze({
    name,
    pageLimits,
    withTransaction,
    query,
    queryAll,
    get,
    aggregate,
    create,
    findOrCreate,
    patch,
    delete: deleteRecord,
    createMany,
    patchMany,
    patchWhere,
    deleteWhere,
    lock,
    lockMany,
    lockWhere,
    lockOrCreate: lockOrCreateRecord,
    claim,
    scopedQuery,
    column,
    raw
  });
}

export { MANY_ROW_CHANNEL, createResourceHandle };
