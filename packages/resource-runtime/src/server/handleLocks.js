import { missingOf, requireDefinedFilters } from "./handleGuards.js";
import { handleRecords, sparseFieldset, textList } from "./handleRecords.js";

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
 */
function createLockReads({ name, resource, jsonRest, readFields, contextOf }) {
  // A locking read (json-rest-api's lockByIds, lockWhere or claim) of the fields options.fields names, as records.
  async function lockRead(method, read, options) {
    const fields = readFields({ fields: options.fields }, "view");
    const { data } = await jsonRest()[method]({
      ...read,
      transaction: options.trx,
      format: "plain",
      ...(fields ? { queryParams: { fields: sparseFieldset(resource, fields) } } : {})
    }, contextOf(options));
    return handleRecords(resource, data, { fields });
  }

  /**
   * Locks the visible rows among the ids, in id order, and answers them; hidden or missing ids throw, or are
   * left out with `missing: "skip"`. MySQL locks every listed id, a hidden one too: take ids from scoped reads.
   * `fields` names the fields the lock reads, so a belongs-to field left out costs no check that its related
   * record is visible; without it every field is read.
   * @param {unknown[]} ids
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[] }} options
   */
  async function lockMany(ids, options) {
    return lockRead("lockByIds", { ids, ...(options.missing ? { missing: options.missing } : {}) }, options);
  }

  /**
   * Locks the record's row until the transaction ends and answers it as the
   * lock saw it. Needs options.trx. A missing or hidden record throws
   * json-rest-api's not-found error, or answers null with `missing: "skip"`.
   * `fields` reads only the fields the work needs (see lockMany).
   * @param {unknown} id
   * @param {{ context?: object | null, trx: object, missing?: "throw" | "skip", fields?: string[] }} options
   */
  async function lock(id, options) {
    missingOf(name, "lock", options.missing);
    const [record] = await lockMany([id], options);
    return record ?? null;
  }

  /**
   * Locks the caller's rows the filters select until the transaction ends, in id
   * order, and answers them; it waits for transactions holding them, so a row that
   * starts to match meanwhile is locked too. At most 1,000 rows (RestApiRowLimitError
   * past that). It does not lock rows inserted later: unique numbers take a unique
   * index, or a counter row taken with lock(). On MySQL it needs an index starting
   * with the ownership columns (no owners: with a filtered column), or it refuses.
   * `fields` reads only the fields the work needs (see lockMany).
   * @param {object} filters
   * @param {{ context?: object | null, trx: object, fields?: string[] }} options
   */
  async function lockWhere(filters, options) {
    requireDefinedFilters(name, "lockWhere", filters);
    return lockRead("lockWhere", { filters }, options);
  }

  /**
   * Takes up to `take` (default 1) of the rows the filters select that no
   * other transaction holds, in `sort` order, locked until the transaction ends.
   * `fields` reads only the fields the work needs (see lockMany).
   * @param {{ filters: object, sort?: string | string[], take?: number }} params
   * @param {{ context?: object | null, trx: object, fields?: string[] }} options
   */
  async function claim({ filters, sort, take } = {}, options, ...rest) {
    if (rest.length > 0) {
      throw new TypeError(`${name}.claim() takes ({ filters, sort, take }, options).`);
    }
    requireDefinedFilters(name, "claim", filters);
    return lockRead("claim", {
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

export { createLockReads };
