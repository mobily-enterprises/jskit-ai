import { checkBlobReads, namedBlobs } from "./handleBlobs.js";
import { missingOf, requireDefinedFilters } from "./handleGuards.js";
import { handleRecords, sparseFieldset, textList } from "./handleRecords.js";

// The row lock a locking read takes. "update" (the default) is FOR UPDATE. "noKeyUpdate" is PostgreSQL's FOR NO KEY
// UPDATE, which still keeps every other lock and write of the row out but lets other transactions insert rows that
// reference it (a foreign key's check takes FOR KEY SHARE); MySQL, MariaDB and SQLite have no weaker exclusive lock and
// lock as for "update".
const LOCK_MODES = Object.freeze(["update", "noKeyUpdate"]);

/**
 * json-rest-api's lock mode for a locking read: none when the call names none, so json-rest-api takes its default.
 * Another value is a TypeError naming the handle method, before anything runs.
 * @param {string} name The resource's name.
 * @param {string} caller The handle method, for the message.
 * @param {unknown} lockMode
 */
function lockModeOf(name, caller, lockMode) {
  if (lockMode === undefined) {
    return {};
  }
  if (!LOCK_MODES.includes(/** @type {string} */ (lockMode))) {
    throw new TypeError(`${name}.${caller}() lockMode is "update" (the default) or "noKeyUpdate". Received: ${JSON.stringify(lockMode)}`);
  }
  return { lockMode };
}

/**
 * Refuses `include` on a locking read, before anything runs: a lock answers only the rows it locks. A plain read of
 * their related records inside the transaction (json-rest-api's includes are plain reads) would see, on MySQL and
 * MariaDB, the snapshot of the transaction's first plain read rather than the rows as they are under the lock, so the
 * caller reads them itself, in the order that makes them current.
 * @param {string} name The resource's name.
 * @param {string} caller The handle method, for the message.
 * @param {unknown} include
 */
function refuseInclude(name, caller, include) {
  if (include === undefined) {
    return;
  }
  throw new TypeError(
    `${name}.${caller}() locks only its own rows and reads no included records, so it takes no include. Read the ` +
      "related records after the lock, in the same transaction: queryAll({ filters: { id: ids }, include }, txOptions) " +
      "or the related table's read by id list. On MySQL and MariaDB a plain read inside a transaction sees the snapshot " +
      "of the transaction's first plain read: take the lock before any plain read, so the reads after it see what the " +
      "lock's previous holder committed, and lock a related row the work depends on with its own lockMany()."
  );
}

/**
 * A handle's locking reads: lock, lockMany, lockWhere and claim. Each needs the
 * caller's transaction (`options.trx`), locks only rows the caller may see, and
 * reads the fields `options.fields` names, or every field a one-record read
 * answers, so a belongs-to field left out costs no check that its related
 * record is visible.
 * @param {object} dependencies
 * @param {string} dependencies.name The resource's name.
 * @param {{ name: string, schema: Record<string, any> }} dependencies.resource
 * @param {() => Record<string, (params: object, context: object) => Promise<{ data: unknown[] }>>} dependencies.jsonRest
 *   The table's json-rest-api resource.
 * @param {(params: { fields?: unknown }, kind: "view") => unknown} dependencies.readFields The fields a read names.
 * @param {(options: object) => object} dependencies.contextOf The call's json-rest-api context, after its scope checks.
 * @param {import("./types.js").HiddenFieldReads} dependencies.hiddenFields The hidden
 *   fields `options.fields` names, read after the lock.
 */
function createLockReads({ name, resource, jsonRest, readFields, contextOf, hiddenFields }) {
  // A locking read (json-rest-api's lockByIds, lockWhere or claim) of the fields options.fields names, as records, in the
  // lock mode options.lockMode names. `caller` is the handle method, for the messages.
  async function lockRead(caller, method, read, options) {
    refuseInclude(name, caller, options.include);
    // lock() and lockMany() hold their ids' blobs, lockWhere() and claim() any number of rows, so they name none.
    checkBlobReads(name, caller, namedBlobs(resource, options.fields, () => null), method === "lockByIds" ? read.ids.length : Infinity);
    const mode = lockModeOf(name, caller, options.lockMode);
    const hidden = hiddenFields.named(options.fields, "plain");
    const fields = readFields({ fields: options.fields }, "view");
    const { data } = await jsonRest()[method]({
      ...read,
      ...mode,
      transaction: options.trx,
      format: "plain",
      ...(fields ? { queryParams: { fields: sparseFieldset(resource, fields) } } : {})
    }, contextOf(options));
    return hiddenFields.add(handleRecords(resource, data, { fields }), hidden, options);
  }

  /**
   * Locks the visible rows among the ids, in id order, and answers them; hidden or missing ids throw, or are
   * left out with `missing: "skip"`. MySQL locks every listed id, a hidden one too: take ids from scoped reads.
   * `fields` names the fields the lock reads, so a belongs-to field left out costs no check that its related
   * record is visible; without it every field is read. `lockMode: "noKeyUpdate"` takes PostgreSQL's FOR NO KEY
   * UPDATE, so other transactions may still insert rows that reference the locked ones (see LOCK_MODES).
   * @param {unknown[]} ids
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[], lockMode?: "update" | "noKeyUpdate" }} options
   */
  async function lockMany(ids, options) {
    return lockRead("lockMany", "lockByIds", { ids, ...(options.missing ? { missing: options.missing } : {}) }, options);
  }

  // lockMany for lock(): its messages name lock().
  function lockOne(id, options) {
    return lockRead("lock", "lockByIds", { ids: [id], ...(options.missing ? { missing: options.missing } : {}) }, options);
  }

  /**
   * Locks the record's row until the transaction ends and answers it as the
   * lock saw it. Needs options.trx. A missing or hidden record throws
   * json-rest-api's not-found error, or answers null with `missing: "skip"`.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * @param {unknown} id
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[], lockMode?: "update" | "noKeyUpdate" }} options
   */
  async function lock(id, options) {
    missingOf(name, "lock", options.missing);
    const [record] = await lockOne(id, options);
    return record ?? null;
  }

  /**
   * Locks the caller's rows the filters select until the transaction ends, in id
   * order, and answers them; it waits for transactions holding them, so a row that
   * starts to match meanwhile is locked too. At most 1,000 rows (RestApiRowLimitError
   * past that). It does not lock rows inserted later: unique numbers take a unique
   * index, or a counter row taken with lock(). On MySQL it needs an index starting
   * with the ownership columns (no owners: with a filtered column), or it refuses.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * @param {object} filters
   * @param {{ context?: object | null, trx: object, fields?: string[], lockMode?: "update" | "noKeyUpdate" }} options
   */
  async function lockWhere(filters, options) {
    requireDefinedFilters(name, "lockWhere", filters);
    return lockRead("lockWhere", "lockWhere", { filters }, options);
  }

  /**
   * Takes up to `take` (default 1) of the rows the filters select that no
   * other transaction holds, in `sort` order, locked until the transaction ends.
   * `fields` reads only the fields the work needs, and `lockMode` picks the lock (see lockMany).
   * @param {{ filters: object, sort?: string | string[], take?: number }} params
   * @param {{ context?: object | null, trx: object, fields?: string[], lockMode?: "update" | "noKeyUpdate" }} options
   */
  async function claim({ filters, sort, take, include } = {}, options, ...rest) {
    if (rest.length > 0) {
      throw new TypeError(`${name}.claim() takes ({ filters, sort, take }, options).`);
    }
    refuseInclude(name, "claim", include);
    requireDefinedFilters(name, "claim", filters);
    return lockRead("claim", "claim", {
      filters,
      ...(take === undefined ? {} : { limit: take }),
      ...(sort === undefined ? {} : { sort: textList(sort) })
    }, options);
  }

  return Object.freeze({
    lock,
    lockMany,
    lockWhere,
    claim
  });
}

export { createLockReads, lockModeOf };
