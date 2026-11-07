import diagnosticsChannel from "node:diagnostics_channel";
import { RestApiRowLimitError } from "json-rest-api";
import { isLostDuplicateInsertRace, retryDeadlocks } from "@jskit-ai/database-runtime/shared";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { createJsonRestContext, isJobContext } from "./contexts.js";
import { MissingScopeError, PageSizeError, RowLimitError, StaleRecordError, UnpagedQueryError } from "./errors.js";
import { handleRecords, handleResult, idOf, inputData, readQueryParams, textList } from "./handleRecords.js";
import {
  returnBadRequestWhenJsonRestFieldsetInvalid,
  returnNullWhenJsonRestResourceMissing
} from "./resourceHost.js";

// Each many-row call publishes { resource, operation, rows, chunkSize } here while something
// subscribes, so a flat-query test can tell the statements chunking adds from statements that
// grow with the rows.
const MANY_ROW_CHANNEL = "jskit:resources:many-row";
const DEFAULT_CHUNK_SIZE = 500;

// A single write's `returning`, as json-rest-api names it.
const SINGLE_RETURNING = Object.freeze({ record: "full", id: "minimal", none: "none" });
// A many-row write's `returning`, as json-rest-api names it.
const MANY_RETURNING = Object.freeze({ none: "none", ids: "minimal", records: "full" });

/**
 * @param {Record<string, string>} modes
 * @param {unknown} value
 * @param {string} fallback
 * @param {string} label
 */
function pickReturning(modes, value, fallback, label) {
  const key = value === undefined ? fallback : value;
  if (typeof key !== "string" || !Object.hasOwn(modes, key)) {
    throw new TypeError(`${label} returning must be one of ${Object.keys(modes).join(", ")}. Received: ${JSON.stringify(value)}`);
  }
  return key;
}

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

// Opens a transaction for work. json-rest-api reports a failure of the work as a RestApiWriteError whose cause is
// the work's error; with asThrown the work's own error reaches the caller as the work threw it.
async function openTransaction(api, options, work, asThrown) {
  let own = null;
  try {
    return await api.transaction(async (trx) => {
      try {
        return await work(Object.freeze({ ...options, trx }));
      } catch (error) {
        own = { error };
        throw error;
      }
    });
  } catch (error) {
    throw asThrown && own && error?.cause === own.error ? own.error : error;
  }
}

// The answer of a many-row write: nothing, the ids, or the records.
function manyResult(resource, result, returning) {
  if (returning === "none") {
    return undefined;
  }
  const rows = result?.data || [];
  return returning === "ids" ? rows.map((row) => String(row.id)) : handleRecords(resource, rows);
}

// A filtered write's selection: its filters, or every owned row when they are empty and `all: true` says so.
function whereSelection(name, operation, filters, options) {
  if (!isRecord(filters)) {
    throw new TypeError(`${name}.${operation}() takes filters as an object.`);
  }
  if (Object.keys(filters).length > 0) {
    if (options.all !== undefined) {
      throw new TypeError(`${name}.${operation}() takes filters or all: true, not both.`);
    }
    return { filters };
  }
  if (options.all !== true) {
    throw new TypeError(`${name}.${operation}() with empty filters changes every row the caller owns; pass all: true to mean it.`);
  }
  return { all: true };
}

/**
 * The record with `attributes.id`, created from `attributes` when it is
 * missing. Outside a transaction, of two concurrent creations one wins and
 * the other answers the winner's record; inside one, a lost race fails the
 * transaction as any failed write does.
 * @param {{ get: Function, create: Function }} handle
 * @param {{ id: unknown } & Record<string, unknown>} attributes
 * @param {{ context?: object | null, trx?: object | null }} [options]
 */
async function findOrCreateRecord({ get, create }, attributes, options) {
  const existing = await get(attributes.id, {}, options);
  if (existing) {
    return existing;
  }
  try {
    return await create(attributes, options);
  } catch (error) {
    if (!isLostDuplicateInsertRace(error, options)) {
      throw error;
    }
    return get(attributes.id, {}, options);
  }
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
 */
function createResourceHandle({ api, resource, hooks, settings }) {
  const name = resource.name;
  const lockVersionField = resource.lockVersionField || "";

  function jsonRest() {
    return api.resources[name];
  }

  function storage() {
    return api.knex.helpers.getStorageAdapter(name);
  }

  /** @param {{ context?: object | null }} options */
  function contextOf(options) {
    if (!options.context && resource.ownership !== "public") {
      throw new MissingScopeError(name);
    }
    return createJsonRestContext(options.context);
  }

  /** @param {{ format?: string }} options */
  function formatOf(options) {
    if (options.format !== undefined && options.format !== "jsonapi") {
      throw new TypeError(`${name} options.format is "jsonapi" (the CRUD service's documents) or absent (records).`);
    }
    return options.format === "jsonapi" ? "jsonapi" : "plain";
  }

  /**
   * Runs work in the caller's transaction (`options.trx`), or in one it opens,
   * commits and, on a deadlock or lock timeout, runs again whole. `work`
   * receives the frozen options it must pass to every call inside. `retry:
   * false` runs work once, for work that cannot be repeated (it calls a
   * provider). A failure of work in a transaction it opened reaches the caller
   * as json-rest-api's RestApiWriteError, with the work's error as its cause and
   * the transaction's outcome; `asThrown: true` rethrows the work's own error as
   * it threw it, for callers that compare or classify it.
   * @template T
   * @param {{ trx?: object | null, context?: object | null }} options
   * @param {(txOptions: Readonly<Record<string, any>>) => Promise<T> | T} work
   * @param {{ retry?: boolean, asThrown?: boolean }} [settingsForCall]
   * @returns {Promise<T>}
   */
  async function withTransaction(options, work, { retry = true, asThrown = false } = {}) {
    if (options.trx) {
      return work(options);
    }
    const run = () => openTransaction(api, options, work, asThrown);
    return retry ? retryDeadlocks(run) : run();
  }

  // A write given no transaction owns one, so it is outermost and may run again.
  function write(options, run) {
    return options.trx ? run() : retryDeadlocks(run);
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
   * `page.size` is required and at most pageLimits().request; `page.after` is the
   * previous page's `next`.
   * @param {{ filters?: object, sort?: string | string[], include?: string | string[], fields?: string[] | object, page?: { size: number, after?: string } }} [params]
   * @param {{ context?: object | null, trx?: object | null, format?: "jsonapi" }} [options]
   */
  async function query(params = {}, options = {}) {
    const format = formatOf(options);
    const queryParams = readQueryParams(name, params, { page: true, caller: "query" });
    const size = params.page?.size;
    if (size == null && format !== "jsonapi") {
      throw new UnpagedQueryError(name);
    }
    if (size != null && Number(size) > pageLimits().request) {
      throw new PageSizeError(name, size, pageLimits().request);
    }
    const payload = await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().query(
      {
        queryParams,
        transaction: options.trx || undefined,
        format
      },
      contextOf(options)
    ));
    if (format === "jsonapi") {
      return payload;
    }
    const pagination = payload.meta?.pagination;
    const hasMore = pagination?.hasMore === true;
    return Object.freeze({
      records: handleRecords(resource, payload.data, params.include),
      page: Object.freeze({ size: Number(size), hasMore, next: hasMore ? pagination.cursor?.next ?? null : null })
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
    try {
      const payload = await returnBadRequestWhenJsonRestFieldsetInvalid(() => jsonRest().queryAll(
        {
          queryParams: readQueryParams(name, params, { page: false, caller: "queryAll" }),
          pageSize: settings.serverPageSize,
          ...(rowLimit === undefined ? {} : { rowLimit }),
          transaction: options.trx || undefined,
          format: "plain"
        },
        context
      ));
      return handleRecords(resource, payload.data, params.include);
    } catch (error) {
      if (error instanceof RestApiRowLimitError && rowLimit !== undefined) {
        throw new RowLimitError(name, rowLimit, error);
      }
      throw error;
    }
  }

  /**
   * One record, or null when it is missing or hidden from the caller.
   * @param {unknown} id
   * @param {{ include?: string | string[], fields?: string[] | object }} [params]
   * @param {{ context?: object | null, trx?: object | null, format?: "jsonapi" }} [options]
   */
  async function get(id, params = {}, options = {}) {
    const format = formatOf(options);
    const result = await returnBadRequestWhenJsonRestFieldsetInvalid(() => returnNullWhenJsonRestResourceMissing(() => jsonRest().get(
      {
        id,
        queryParams: readQueryParams(name, params, { page: false, caller: "get" }),
        transaction: options.trx || undefined,
        format
      },
      contextOf(options)
    )));
    return result === null ? null : handleResult(resource, result, format, params.include);
  }

  /**
   * Totals: `measures` ({ name: { count | countDistinct | sum | avg | min | max: field, where? } })
   * over the filtered rows, grouped by `groupBy` fields or date buckets. Answers the rows.
   * @param {{ measures: object, groupBy?: Array<string | object>, filters?: object, sort?: string[], page?: object }} spec
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function aggregate({ measures, groupBy, filters, sort, page }, options = {}) {
    const result = await jsonRest().aggregate(
      {
        measures,
        ...(groupBy === undefined ? {} : { groupBy }),
        queryParams: {
          ...(filters === undefined ? {} : { filters }),
          ...(sort === undefined ? {} : { sort: textList(sort) }),
          ...(page === undefined ? {} : { page })
        },
        transaction: options.trx || undefined
      },
      contextOf(options)
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
    const format = formatOf(options);
    // An afterWrite hook needs the new id, so a create returning nothing still asks for it.
    const askFor = hooks.afterWrite && returning === "none" ? "id" : returning;
    const result = await hooked("create", options, (callOptions) => jsonRest().post(
      {
        data: inputData(resource, attributes),
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

  // An empty patch reads the record instead, unless it moves the lock version on: a lockVersion patch always writes.
  async function patchRecord(id, attributes, options, returning, { advance = false } = {}) {
    if (Object.keys(attributes).length < 1 && !advance) {
      const current = await get(id, {}, options);
      if (!current || returning === "record") {
        return current;
      }
      return returning === "id" ? id : undefined;
    }
    const result = await returnNullWhenJsonRestResourceMissing(() => hooked("patch", options, (callOptions) => jsonRest().patch(
      {
        id,
        data: inputData(resource, attributes),
        returning: SINGLE_RETURNING[returning],
        transaction: callOptions.trx || undefined,
        format: formatOf(callOptions)
      },
      contextOf(callOptions)
    ), () => [String(id)]));
    if (result === null) {
      return null;
    }
    if (returning === "none") {
      return undefined;
    }
    return returning === "id" ? id : handleResult(resource, result, formatOf(options));
  }

  /**
   * Patches one record; null when it is missing or hidden (inside the caller's
   * transaction a missing record throws instead, since the failed write fails
   * that transaction). `lockVersion` patches
   * only while the record's lockVersionField still holds it (StaleRecordError,
   * 409, otherwise); `onlyIf: { field: value }` patches only while the stored
   * values still equal these, and answers null otherwise. Both lock the row in
   * the transaction first. The lock version advances on every update.
   * @param {unknown} id
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "record" | "id" | "none", lockVersion?: number, onlyIf?: Record<string, unknown>, format?: "jsonapi" }} [options]
   */
  async function patch(id, attributes, options = {}) {
    if (!isRecord(attributes)) {
      throw new TypeError(`${name}.patch() takes attributes as an object.`);
    }
    const { lockVersion, onlyIf, ...callOptions } = options;
    const returning = pickReturning(SINGLE_RETURNING, callOptions.returning, "record", `${name}.patch()`);
    if (lockVersion === undefined && onlyIf === undefined) {
      return patchRecord(id, attributes, callOptions, returning);
    }
    if (lockVersion !== undefined) {
      if (!lockVersionField) {
        throw new TypeError(`${name}.patch() lockVersion needs the resource to name its lockVersionField.`);
      }
      if (!Number.isSafeInteger(lockVersion) || lockVersion < 0) {
        throw new TypeError(`${name}.patch() lockVersion must be a non-negative integer. Received: ${lockVersion}`);
      }
      if (Object.hasOwn(attributes, lockVersionField)) {
        throw new TypeError(`${name}.patch() advances ${lockVersionField} itself, so the attributes must leave it out.`);
      }
    }
    if (onlyIf !== undefined && !isRecord(onlyIf)) {
      throw new TypeError(`${name}.patch() onlyIf must be an object of field values.`);
    }
    return withTransaction(callOptions, async (txOptions) => {
      const [current] = await lockMany([id], { ...txOptions, missing: "skip" });
      if (!current) {
        return null;
      }
      if (lockVersion !== undefined && Number(current[lockVersionField]) !== lockVersion) {
        throw new StaleRecordError();
      }
      if (onlyIf !== undefined && Object.entries(onlyIf).some(([field, value]) => (current[field] ?? null) !== value)) {
        return null;
      }
      return patchRecord(id, attributes, txOptions, returning, { advance: lockVersion !== undefined });
    });
  }

  /**
   * Deletes one record. Answers null, also when it is missing or hidden (inside
   * the caller's transaction a missing record throws, as for patch).
   * @param {unknown} id
   * @param {{ context?: object | null, trx?: object | null }} [options]
   */
  async function deleteRecord(id, options = {}) {
    return returnNullWhenJsonRestResourceMissing(async () => {
      await hooked("delete", options, (callOptions) => jsonRest().delete(
        {
          id,
          returning: "none",
          transaction: callOptions.trx || undefined,
          format: formatOf(callOptions)
        },
        contextOf(callOptions)
      ), () => [String(id)]);
      return null;
    });
  }

  function manyRowWrite(operation, rows, options, request) {
    const returning = pickReturning(MANY_RETURNING, options.returning, "none", `${name}.${operation}()`);
    const askFor = hooks.afterWrite && returning === "none" ? "ids" : returning;
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
   * the ownership fields, and merge is refused under a row policy.
   * `returning`: "none" (default), "ids" or "records".
   * @param {Array<Record<string, unknown>>} rows
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records", onConflict?: object, chunkSize?: number }} [options]
   */
  async function createMany(rows, options = {}) {
    if (!Array.isArray(rows)) {
      throw new TypeError(`${name}.createMany() takes an array of rows.`);
    }
    // An upsert matches rows by its conflict keys alone: a row naming its id could update another owner's record.
    if (options.onConflict && rows.some((row) => isRecord(row) && Object.hasOwn(row, "id"))) {
      throw new TypeError(`${name}.createMany() with onConflict takes rows without an id; the conflict keys find the existing rows.`);
    }
    return manyRowWrite("createMany", rows.length, options, (params, context) => jsonRest().postMany(
      { ...params, data: rows.map((row) => inputData(resource, row)), ...(options.onConflict ? { onConflict: options.onConflict } : {}) },
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
    return manyRowWrite("patchMany", rows.length, options, (params, context) => jsonRest().patchMany(
      {
        ...params,
        data: rows.map(({ id, ...changes }) => ({ id, ...inputData(resource, changes) })),
        ...(options.onlyIf ? { onlyIf: options.onlyIf } : {}),
        ...(options.missing ? { missing: options.missing } : {})
      },
      context
    ));
  }

  /**
   * The same changes to every listed record, as patchMany.
   * @param {unknown[]} ids
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records", onlyIf?: object, missing?: "throw" | "skip", chunkSize?: number }} [options]
   */
  async function patchWhereIds(ids, attributes, options = {}) {
    return manyRowWrite("patchWhereIds", ids.length, options, (params, context) => jsonRest().patchWhereIds(
      {
        ...params,
        ids,
        data: inputData(resource, attributes),
        ...(options.onlyIf ? { onlyIf: options.onlyIf } : {}),
        ...(options.missing ? { missing: options.missing } : {})
      },
      context
    ));
  }

  /**
   * The same changes to every record the filters select (the caller's own rows only).
   * Empty filters change every row the caller owns, so they need `all: true`.
   * @param {object} filters
   * @param {Record<string, unknown>} attributes
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids" | "records", onlyIf?: object, all?: boolean, chunkSize?: number }} [options]
   */
  async function patchWhere(filters, attributes, options = {}) {
    const selection = whereSelection(name, "patchWhere", filters, options);
    return manyRowWrite("patchWhere", 0, options, (params, context) => jsonRest().patchWhere(
      { ...params, ...selection, data: inputData(resource, attributes), ...(options.onlyIf ? { onlyIf: options.onlyIf } : {}) },
      context
    ));
  }

  /**
   * Deletes the listed records, one DELETE per chunk. `returning`: "none" or "ids".
   * @param {unknown[]} ids
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids", missing?: "throw" | "skip", chunkSize?: number }} [options]
   */
  async function deleteMany(ids, options = {}) {
    if (options.returning === "records") {
      throw new TypeError(`${name}.deleteMany() returning is "none" or "ids".`);
    }
    return manyRowWrite("deleteMany", ids.length, options, ({ format: _format, ...params }, context) => jsonRest().deleteMany(
      { ...params, ids, ...(options.missing ? { missing: options.missing } : {}) },
      context
    ));
  }

  /**
   * Deletes every record the filters select (the caller's own rows only).
   * Empty filters delete every row the caller owns, so they need `all: true`.
   * @param {object} filters
   * @param {{ context?: object | null, trx?: object | null, returning?: "none" | "ids", all?: boolean, chunkSize?: number }} [options]
   */
  async function deleteWhere(filters, options = {}) {
    if (options.returning === "records") {
      throw new TypeError(`${name}.deleteWhere() returning is "none" or "ids".`);
    }
    const selection = whereSelection(name, "deleteWhere", filters, options);
    return manyRowWrite("deleteWhere", 0, options, ({ format: _format, ...params }, context) => jsonRest().deleteWhere(
      { ...params, ...selection },
      context
    ));
  }

  /**
   * Locks the record's row until the transaction ends and answers it as the
   * lock saw it. Needs options.trx; a hidden or missing id throws.
   * @param {unknown} id
   * @param {{ context?: object | null, trx: object }} options
   */
  async function lock(id, options) {
    const [record] = await lockMany([id], options);
    return record;
  }

  /**
   * Locks the visible rows among the ids, in id order, and answers them.
   * Hidden or missing ids throw, or are left out with `missing: "skip"`.
   * @param {unknown[]} ids
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip" }} options
   */
  async function lockMany(ids, options) {
    const { data } = await jsonRest().lockByIds(
      { ids, transaction: options.trx, format: "plain", ...(options.missing ? { missing: options.missing } : {}) },
      contextOf(options)
    );
    return handleRecords(resource, data);
  }

  /**
   * Locks the caller's rows the filters select, as lockMany. It does not lock
   * rows inserted later: unique numbers take a unique index, or a counter row
   * taken with lock().
   * @param {object} filters
   * @param {{ context?: object | null, trx: object }} options
   */
  async function lockWhere(filters, options) {
    const { query: visible } = await jsonRest().scopedQuery(
      { filters, purpose: "lock", transaction: options.trx },
      contextOf(options)
    );
    const ids = await visible.pluck(storage().getIdColumn());
    return ids.length > 0 ? lockMany(ids, { ...options, missing: "skip" }) : [];
  }

  /**
   * Takes up to `limit` (default 1) of the rows the filters select that no
   * other transaction holds, in `sort` order, locked until the transaction ends.
   * @param {object} filters
   * @param {{ limit?: number, sort?: string[] }} take
   * @param {{ context?: object | null, trx: object }} options
   */
  async function claim(filters, { limit, sort } = {}, options) {
    const { data } = await jsonRest().claim(
      {
        filters,
        ...(limit === undefined ? {} : { limit }),
        ...(sort === undefined ? {} : { sort: textList(sort) }),
        transaction: options.trx,
        format: "plain"
      },
      contextOf(options)
    );
    return handleRecords(resource, data);
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
    return jsonRest().scopedQuery({ ...params, transaction: options.trx || undefined }, contextOf(options));
  }

  /**
   * A field's storage column, qualified by the table or the given alias.
   * @param {string} field
   * @param {string} [alias]
   */
  function column(field, alias = resource.tableName) {
    const adapter = storage();
    const storageColumn = field === "id" ? adapter.getIdColumn() : adapter.translateColumn(field);
    return alias ? `${alias}.${storageColumn}` : storageColumn;
  }

  /**
   * One SQL expression for a scoped query: a literal string, with its values
   * (and its identifiers, as `??` with column()) given as bindings.
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
    return api.knex.instance.raw(sql, bindings || []);
  }

  /**
   * Full storage rows (from a scoped query's select of every column) as records:
   * each column renamed to its field.
   * @param {Array<Record<string, unknown>>} rows
   */
  function toRecords(rows) {
    const fieldByColumn = new Map([["id", "id"], [column("id", ""), "id"]]);
    for (const field of Object.keys(resource.schema)) {
      if (field !== "id") {
        fieldByColumn.set(column(field, ""), field);
      }
    }
    return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [fieldByColumn.get(key) || key, value])));
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
    patchWhereIds,
    patchWhere,
    deleteMany,
    deleteWhere,
    lock,
    lockMany,
    lockWhere,
    claim,
    scopedQuery,
    column,
    raw,
    toRecords
  });
}

export { MANY_ROW_CHANNEL, createResourceHandle };
