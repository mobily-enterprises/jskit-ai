import { RestApiResourceError } from "json-rest-api";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { isJobContext } from "./contexts.js";
import { namedFields } from "./handleRecords.js";

// A hidden field (`hidden: true`) is one json-rest-api never selects or answers, so no request, CRUD route or JSON:API
// document carries it. A handle's plain read still answers one when its `fields` names it, for the table's owner and
// for system work: the owner's own commands (a bearer token it checks) and a job that must learn each row's owner.

// The hidden field types a read answers: their stored values read as json-rest-api reads them without decoding.
const READABLE_TYPES = Object.freeze(new Set(["id", "string", "integer", "number", "boolean"]));
// The records each statement of the hidden fields' read covers.
const RECORDS_PER_READ = 1000;
// Where each read takes `fields` and where its options, by argument position.
const FIELD_READS = Object.freeze({
  get: Object.freeze({ fieldsAt: 1, optionsAt: 2 }),
  query: Object.freeze({ fieldsAt: 0, optionsAt: 1 }),
  queryAll: Object.freeze({ fieldsAt: 0, optionsAt: 1 }),
  lock: Object.freeze({ fieldsAt: 1, optionsAt: 1 }),
  lockMany: Object.freeze({ fieldsAt: 1, optionsAt: 1 }),
  lockWhere: Object.freeze({ fieldsAt: 1, optionsAt: 1 }),
  claim: Object.freeze({ fieldsAt: 1, optionsAt: 1 })
});

/**
 * The resource's hidden fields a read's `fields` names.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} fields
 */
function namedHiddenFields(resource, fields) {
  const named = namedFields(resource, fields);
  return named ? [...named].filter((field) => resource.schema[field]?.hidden === true) : [];
}

/**
 * A hidden field's stored value as a read answers it, as json-rest-api reads its type: an id as text, a whole
 * number or a non-decimal number as a number (text past the safe integers), 0 and 1 as booleans.
 * @param {unknown} value
 * @param {{ type: string, precision?: number, scale?: number }} definition
 */
function storedValue(value, { type, precision, scale }) {
  if (value == null) {
    return null;
  }
  if (type === "id") {
    return String(value);
  }
  if (type === "boolean") {
    return value === 1 || value === "1" ? true : value === 0 || value === "0" ? false : value;
  }
  const decimal = precision !== undefined && scale !== undefined;
  if ((type === "integer" || type === "number") && typeof value === "string" && !decimal) {
    const number = Number(value);
    return value.trim() !== "" && Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)) ? number : value;
  }
  return value;
}

/**
 * A handle's reads of the hidden fields a plain read's `fields` names, which json-rest-api leaves out: one more
 * statement per 1,000 records, on the table as scopedQuery() gives it (the caller's ownership and the row policy
 * applied), in the call's transaction.
 * @param {object} dependencies
 * @param {{ name: string, schema: Record<string, any> }} dependencies.resource
 * @param {(params: { filters: object }, options: object) => Promise<{ query: any }>} dependencies.scopedQuery
 * @param {(field: string) => string} dependencies.column
 */
function createHiddenFieldReads({ resource, scopedQuery, column }) {
  /**
   * The hidden fields a plain read names, checked before it runs: each is a stored id, string, number or boolean.
   * @param {unknown} fields
   * @param {string | undefined} format
   */
  function named(fields, format) {
    if (format === "jsonapi") {
      return [];
    }
    const hidden = namedHiddenFields(resource, fields);
    for (const field of hidden) {
      const definition = resource.schema[field];
      if (!READABLE_TYPES.has(definition.type) || definition.virtual === true || definition.storage?.virtual === true) {
        throw new TypeError(
          `${resource.name}: fields names the hidden field "${field}", but a read answers a hidden field only when it ` +
            "is a stored id, string, integer, number or boolean."
        );
      }
    }
    return hidden;
  }

  /**
   * The records, each with the hidden fields added. A record whose row the added statement no longer sees (deleted
   * since, outside a transaction) is left out.
   * @param {Array<Record<string, any>>} records
   * @param {string[]} hidden
   * @param {{ context?: object | null, trx?: object | null }} options
   */
  async function add(records, hidden, options) {
    if (hidden.length < 1 || records.length < 1) {
      return records;
    }
    const rows = new Map();
    const ids = records.map(({ id }) => id);
    for (let start = 0; start < ids.length; start += RECORDS_PER_READ) {
      const { query } = await scopedQuery({ filters: { id: ids.slice(start, start + RECORDS_PER_READ) } }, options);
      const read = await query.select({ id: column("id"), ...Object.fromEntries(hidden.map((field) => [field, column(field)])) });
      for (const row of read) {
        rows.set(String(row.id), row);
      }
    }
    return records.flatMap((record) => {
      const row = rows.get(String(record.id));
      return row
        ? [{ ...record, ...Object.fromEntries(hidden.map((field) => [field, storedValue(row[field], resource.schema[field])])) }]
        : [];
    });
  }

  /**
   * One record with the hidden fields added. A record deleted since it was read is missing: null with
   * `missing: "skip"`, else json-rest-api's not-found error.
   * @param {Record<string, any>} record
   * @param {string[]} hidden
   * @param {{ context?: object | null, trx?: object | null, missing?: "throw" | "skip" }} options
   */
  async function addOne(record, hidden, options) {
    const [read] = await add([record], hidden, options);
    if (read || options.missing === "skip") {
      return read ?? null;
    }
    throw new RestApiResourceError("Resource not found", { subtype: "not_found", resourceType: resource.name, resourceId: record.id });
  }

  return Object.freeze({
    named,
    add,
    addOne
  });
}

/**
 * The repository an owner gives other features (a CRUD feature's `resourceApi.repository`): the same repository,
 * except that a read whose `fields` names a hidden field of the resource, and any scopedQuery() (its builder carries
 * every column, hidden ones too), is refused unless it runs in a system context or one it derived. The owner's own
 * code, its join sources included, reads with the repository itself. A resource without hidden fields keeps its
 * repository as it is.
 * @template {object} T
 * @param {T} repository
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @returns {T}
 */
function withoutHiddenFields(repository, resource) {
  if (!isRecord(repository) || !Object.values(resource.schema).some((definition) => definition?.hidden === true)) {
    return repository;
  }
  const descriptors = Object.getOwnPropertyDescriptors(repository);
  const { scopedQuery } = repository;
  // readable-check: allow method-probe - data: an owner's repository may leave out scopedQuery
  if (typeof scopedQuery === "function") {
    descriptors.scopedQuery = {
      enumerable: true,
      value: async function scopedQueryWithoutHiddenFields(params, options) {
        if (!isJobContext(options?.context)) {
          throw new TypeError(
            `${resource.name}.scopedQuery() answers every column, its hidden fields too, which only the table's owner, ` +
              "or a system context, reads: ask the owner for a method answering the rows or a join source."
          );
        }
        return scopedQuery.call(repository, params, options);
      }
    };
  }
  for (const [method, { fieldsAt, optionsAt }] of Object.entries(FIELD_READS)) {
    const read = repository[method];
    // readable-check: allow method-probe - data: an owner's repository may leave out any of the reads
    if (typeof read !== "function") {
      continue;
    }
    descriptors[method] = {
      enumerable: true,
      value: async function readWithoutHiddenFields(...args) {
        const hidden = isJobContext(args[optionsAt]?.context) ? [] : namedHiddenFields(resource, args[fieldsAt]?.fields);
        if (hidden.length > 0) {
          throw new TypeError(
            `${resource.name}.${method}() fields names the hidden field ${hidden.map((field) => `"${field}"`).join(", ")}, ` +
              "which only the table's owner, or a system context, reads."
          );
        }
        return read.apply(repository, args);
      }
    };
  }
  return Object.freeze(Object.create(Object.getPrototypeOf(repository), descriptors));
}

export { createHiddenFieldReads, withoutHiddenFields };
