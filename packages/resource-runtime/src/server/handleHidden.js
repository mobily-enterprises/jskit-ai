import { RestApiResourceError, readOnlyQueryBuilder } from "json-rest-api";
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

// Every resource handle's scopedQuery, whose builder carries every column, and its withTransaction and lockOrCreate,
// which answer the caller's own work: withoutHiddenFields tells them by identity, under any name.
const HANDLE_SCOPED_QUERIES = new WeakSet();
const HANDLE_WORK_RUNNERS = new WeakSet();
// The names an owner's own wrappers of those runners keep.
const WORK_RUNNER_NAMES = Object.freeze(new Set(["withTransaction", "lockOrCreate"]));
// The builders a handle's joinSource() answers, which carry the table's visible columns and ownership fields only: the
// one query builder withoutHiddenFields hands another feature.
const JOIN_SOURCES = new WeakSet();

/**
 * Records a new handle's scopedQuery, withTransaction and lockOrCreate for withoutHiddenFields.
 * @param {{ scopedQuery: Function, withTransaction: Function, lockOrCreate: Function }} handle
 */
function markHandleFunctions({ scopedQuery, withTransaction, lockOrCreate }) {
  HANDLE_SCOPED_QUERIES.add(scopedQuery);
  HANDLE_WORK_RUNNERS.add(withTransaction);
  HANDLE_WORK_RUNNERS.add(lockOrCreate);
}

/**
 * A handle's joinSource(): the table as a join source for another owner's report, which joins it in its own
 * statement. It answers `{ query, column }`: the rows scopedQuery() gives under `alias` (the caller's ownership, the
 * row policy and `filters` applied) with the stored columns a read answers and the ownership fields, hidden or not,
 * since a report joins on them and they name the caller's own scope; never another hidden column. `column(field)`
 * names each under that alias. A CRUD feature's repository answers it to any feature, where it
 * refuses scopedQuery(). The builder comes wrapped, since a builder is thenable.
 * @param {object} dependencies
 * @param {{ knex: { instance: any } }} dependencies.api
 * @param {{ name: string, schema: Record<string, any> }} dependencies.resource
 * @param {() => { vars: { schemaInfo: { schemaStructure: Record<string, any>, ownershipFields?: string[] } } }} dependencies.jsonRest
 * @param {(params: { alias: string, filters?: object }, options: object) => Promise<{ query: any }>} dependencies.scopedQuery
 * @param {(field: string, alias?: string) => string} dependencies.column
 */
function createJoinSource({ api, resource, jsonRest, scopedQuery, column }) {
  const { name } = resource;
  /**
   * @param {{ alias: string, filters?: object }} params
   * @param {{ context?: object | null, trx?: object | null }} [options]
   * @returns {Promise<Readonly<{ query: any, column: (field: string) => string }>>}
   */
  return async function joinSource({ alias, filters } = {}, options = {}) {
    if (typeof alias !== "string" || !alias) {
      throw new TypeError(`${name}.joinSource() needs the alias the report joins the ${name} under.`);
    }
    const { query } = await scopedQuery({ alias, ...(filters === undefined ? {} : { filters }) }, options);
    const { schemaStructure, ownershipFields = [] } = jsonRest().vars.schemaInfo;
    const joinKeys = new Set(ownershipFields);
    const carried = Object.keys(schemaStructure).filter((field) => {
      const definition = schemaStructure[field];
      return field !== "id" && (definition.hidden !== true || joinKeys.has(field)) &&
        definition.virtual !== true && !definition.belongsToPolymorphic;
    });
    // The scoped rows' visible columns and ownership fields, as a derived table under the alias: nothing a caller adds
    // reaches the others.
    const source = readOnlyQueryBuilder(
      (options.trx || api.knex.instance).from(query.select(["id", ...carried].map((field) => column(field, alias))).as(alias)),
      { resourceType: name }
    );
    JOIN_SOURCES.add(source);
    return Object.freeze({
      query: source,
      column(field) {
        if (resource.schema[field]?.hidden === true && !joinKeys.has(field)) {
          throw new TypeError(`${name}.joinSource() carries no hidden field but its ownership fields, so it has no column for "${field}".`);
        }
        return column(field, alias);
      }
    });
  };
}

/**
 * The field names a call's `fields` names: a list of names, names separated by commas, or a sparse fieldset (each
 * resource type's names, separated by commas).
 * @param {unknown} fields
 * @returns {string[]}
 */
function fieldNames(fields) {
  if (typeof fields === "string") {
    return fields.split(",").map((field) => field.trim());
  }
  if (Array.isArray(fields)) {
    return fields.filter((field) => typeof field === "string");
  }
  return isRecord(fields)
    ? Object.values(fields).flatMap((names) => (typeof names === "string" || Array.isArray(names) ? fieldNames(names) : []))
    : [];
}

/**
 * Whether a function answered a Knex value (a raw expression, a column's builder, a joinSource()'s query builder)
 * rather than rows: a value for the caller's own query, which it builds on and never awaits.
 * @param {unknown} value
 */
function isKnexValue(value) {
  // readable-check: allow method-probe - data: Knex raw expressions and query builders compile through toSQL()
  return isRecord(value) && typeof value.toSQL === "function";
}

/**
 * A Knex value another feature may build on, as it is: a raw expression or a column's reference, or a joinSource()'s
 * builder. Any other query builder (a scopedQuery()'s, or one the owner built) can select every column of its table,
 * the hidden ones too, so it is refused.
 * @param {any} value A Knex value (see isKnexValue).
 * @param {string} label
 */
function withoutFullBuilder(value, label) {
  // readable-check: allow method-probe - data: a Knex query builder, unlike a raw expression, takes where()
  if (typeof value.where === "function" && !JOIN_SOURCES.has(value)) {
    throw new TypeError(
      `${label} answers a query builder, which can select every column, the hidden fields too, which only the table's ` +
        "owner, or a system context, reads: answer the table's joinSource({ alias }, options), which carries its visible " +
        "columns only."
    );
  }
  return value;
}

/** @param {unknown} value */
function isPlainRecord(value) {
  if (!isRecord(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The value without the hidden fields, wherever a plain record in it, or in its arrays and maps, carries one: a copy
 * of what changed (frozen when the original was), the value itself when nothing did. A query builder in it that is no
 * joinSource()'s is refused (see withoutFullBuilder); raw expressions, dates and other instances are left as they are.
 * @param {unknown} value
 * @param {Set<string>} hidden
 * @param {string} label
 * @param {WeakMap<object, unknown>} [seen]
 */
function withoutHiddenValues(value, hidden, label, seen = new WeakMap()) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (isKnexValue(value)) {
    return withoutFullBuilder(value, label);
  }
  if (seen.has(value)) {
    return seen.get(value);
  }
  seen.set(value, value);
  let changed = false;
  const strip = (entry) => {
    const next = withoutHiddenValues(entry, hidden, label, seen);
    changed ||= next !== entry;
    return next;
  };
  let copy;
  if (Array.isArray(value)) {
    copy = value.map(strip);
  } else if (value instanceof Map) {
    copy = new Map([...value].map(([key, entry]) => [key, strip(entry)]));
  } else if (isPlainRecord(value)) {
    copy = Object.create(Object.getPrototypeOf(value));
    for (const [key, entry] of Object.entries(value)) {
      if (hidden.has(key)) {
        changed = true;
      } else {
        copy[key] = strip(entry);
      }
    }
  } else {
    return value;
  }
  const result = !changed ? value : Object.isFrozen(value) && !(value instanceof Map) ? Object.freeze(copy) : copy;
  seen.set(value, result);
  return result;
}

/**
 * The repository an owner gives other features (a CRUD feature's `resourceApi.repository`): every function it holds,
 * its sub-repositories' included, answers without the hidden fields of the tables the owner owns. A call whose
 * `fields` (in any record it takes) names one of those hidden fields is refused before it runs, whatever the method,
 * so a read the owner adds in decorateRepository that forwards the caller's `fields` fails loudly rather than answer
 * the field as undefined; so is any scopedQuery(), and an answer holding a query builder other than a joinSource()'s
 * (either can select every column, hidden ones too). A call in a system context or one it derived, in any record it
 * takes, runs as it is. The owner's own code reads with the repository itself. withTransaction and lockOrCreate answer
 * the caller's own work as it is, and a function answering a Knex value (raw(), a joinSource()'s builder) answers it
 * as it is, unawaited. A repository whose tables have no hidden fields stays as it is. Hidden fields are told by
 * name, so a field one owned table hides and another shows is refused here, when the feature's repository is built.
 * @template {object} T
 * @param {T} repository
 * @param {{ name: string, schema: Record<string, any> } | ReadonlyArray<{ name: string, schema: Record<string, any> }>} resources
 *   The resource the repository serves, or it first and the other tables its owner owns.
 * @returns {T}
 */
function withoutHiddenFields(repository, resources) {
  const owned = [resources].flat();
  const hidden = new Set(owned.flatMap(({ schema }) => Object.keys(schema).filter((field) => schema[field]?.hidden === true)));
  if (!isRecord(repository) || hidden.size < 1) {
    return repository;
  }
  for (const { name, schema } of owned) {
    const shown = Object.keys(schema).find((field) => hidden.has(field) && schema[field]?.hidden !== true);
    if (shown) {
      const hiders = owned.filter((other) => other.schema[shown]?.hidden === true).map((other) => other.name);
      throw new TypeError(
        `${name}.${shown} is a visible field, but ${hiders.join(", ")}, which the same feature owns, hides a field of that ` +
          `name; its repository strips hidden fields by name from every answer, so ${name}.${shown} would never reach ` +
          "another feature: hide it in both tables, or rename one of them."
      );
    }
  }
  return guardedRepository(repository, owned[0], hidden, new WeakSet());
}

/**
 * @param {object} repository
 * @param {{ name: string, schema: Record<string, any> } | null} resource The resource it serves, which names its methods
 *   in errors and whose scopedQuery it refuses under that name too; none for a sub-repository.
 * @param {Set<string>} hidden
 * @param {WeakSet<object>} guarded
 */
function guardedRepository(repository, resource, hidden, guarded) {
  guarded.add(repository);
  const descriptors = Object.getOwnPropertyDescriptors(repository);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const { value } = descriptor;
    // readable-check: allow method-probe - data: every function a repository holds is guarded, whatever its name
    if (typeof value === "function") {
      descriptors[key] = { ...descriptor, value: guardedFunction(repository, key, value, resource, hidden) };
    } else if (isPlainRecord(value) && !guarded.has(value)) {
      descriptors[key] = { ...descriptor, value: guardedRepository(value, null, hidden, guarded) };
    }
  }
  return Object.freeze(Object.create(Object.getPrototypeOf(repository), descriptors));
}

/**
 * @param {object} repository
 * @param {string} key
 * @param {Function} call
 * @param {{ name: string, schema: Record<string, any> } | null} resource
 * @param {Set<string>} hidden
 */
function guardedFunction(repository, key, call, resource, hidden) {
  const label = `${resource?.name ?? "repository"}.${key}()`;
  const builder = HANDLE_SCOPED_QUERIES.has(call) || (resource !== null && key === "scopedQuery");
  const work = HANDLE_WORK_RUNNERS.has(call) || WORK_RUNNER_NAMES.has(key);
  return function callWithoutHiddenFields(...args) {
    // A system context, or one it derived, in whichever record the method takes its options.
    if (args.some((arg) => isRecord(arg) && isJobContext(arg.context))) {
      return call.apply(repository, args);
    }
    if (builder) {
      return Promise.reject(new TypeError(
        `${label} answers every column, its hidden fields too, which only the table's owner, or a system context, ` +
          "reads: read the rows through the repository's reads, or join its joinSource({ alias }, options), which " +
          "carries the visible columns only."
      ));
    }
    const named = [...new Set(args.flatMap((arg) => (isRecord(arg) ? fieldNames(arg.fields) : [])))]
      .filter((field) => hidden.has(field));
    if (named.length > 0) {
      return Promise.reject(new TypeError(
        `${label} fields names the hidden field ${named.map((field) => `"${field}"`).join(", ")}, ` +
          "which only the table's owner, or a system context, reads."
      ));
    }
    const answer = call.apply(repository, args);
    // A runner's answer is the caller's own work: it passes as it is.
    if (work) {
      return answer;
    }
    // A Knex value (raw(), a joinSource()'s builder) carries no rows: it passes as it is, unawaited, so a builder
    // never runs here.
    if (isKnexValue(answer)) {
      return withoutFullBuilder(answer, label);
    }
    // readable-check: allow method-probe - data: a repository's method may answer at once or with a promise
    return typeof answer?.then === "function"
      ? answer.then((value) => withoutHiddenValues(value, hidden, label))
      : withoutHiddenValues(answer, hidden, label);
  };
}

export { createHiddenFieldReads, createJoinSource, markHandleFunctions, withoutHiddenFields };
