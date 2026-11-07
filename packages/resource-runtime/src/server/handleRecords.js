import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { RECORD_TIMESTAMPS, storedTimestamps } from "@jskit-ai/resource-core/shared/tableResource";
import { isJobContext } from "./contexts.js";
import { requireDefinedFilters } from "./handleGuards.js";

// What a handle takes and answers, in json-rest-api's terms: read parameters,
// write input with belongs-to fields under their relationships, and plain
// records with each belongs-to field as the related id.

const READ_PARAM_KEYS = Object.freeze(["filters", "sort", "include", "fields", "page"]);

/** @param {unknown} value */
function textList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * The read parameters of a handle call as json-rest-api's queryParams.
 * @param {string} name
 * @param {Record<string, any>} params
 * @param {{ page: boolean, caller: string }} allowed
 */
function readQueryParams(name, params, { page, caller }) {
  if (!isRecord(params)) {
    throw new TypeError(`${name}.${caller}() params must be an object.`);
  }
  for (const key of Object.keys(params)) {
    if (!READ_PARAM_KEYS.includes(key) || (key === "page" && !page)) {
      throw new TypeError(`${name}.${caller}() does not take ${key}; it takes ${READ_PARAM_KEYS.filter((entry) => page || entry !== "page").join(", ")}.`);
    }
  }
  const queryParams = {};
  if (params.filters !== undefined) {
    queryParams.filters = requireDefinedFilters(name, caller, params.filters);
  }
  if (params.sort !== undefined) {
    queryParams.sort = textList(params.sort);
  }
  if (params.include !== undefined) {
    queryParams.include = textList(params.include);
  }
  if (params.fields !== undefined) {
    queryParams.fields = Array.isArray(params.fields) ? { [name]: params.fields.join(",") } : params.fields;
  }
  if (page && params.page !== undefined) {
    const { after, number } = params.page;
    if (number !== undefined && (after || !Number.isSafeInteger(number) || number < 1)) {
      throw new TypeError(`${name}.${caller}() takes page.number as a whole number from 1, and not with page.after.`);
    }
    // A CRUD list may name only its cursor: json-rest-api then serves its default page size.
    queryParams.page = {
      ...(params.page.size == null ? {} : { size: Number(params.page.size) }),
      ...(after ? { after } : {}),
      ...(number === undefined ? {} : { number })
    };
  }
  return queryParams;
}

/**
 * The id in a single write's answer: a record or `{ type, id }`, wrapped in
 * `data` for JSON:API documents.
 * @param {unknown} result
 * @param {string} format
 */
function idOf(result, format) {
  const resource = format === "jsonapi" && isRecord(result) ? result.data : result;
  return isRecord(resource) ? resource.id : undefined;
}

/**
 * Whether a write may set its own timestamps: in a system context, or one it derived (an import, a migration, a
 * seed), and in a call without a context, which only server code makes, on a public table such as a sign-in store.
 * A request always carries its context, so its timestamps are always the handle's.
 * @param {unknown} context
 */
function setsOwnTimestamps(context) {
  return !context || isJobContext(context);
}

/**
 * A write's attributes with the table's timestamps (see storedTimestamps). The handle's stamps replace any the
 * caller sends, unless it may set its own (setsOwnTimestamps), so a request never sets them. A create stamps
 * createdAt and updatedAt, a change of a record updatedAt, and an empty change nothing.
 * @param {{ schema: Record<string, any> }} resource
 * @param {Record<string, unknown>} attributes
 * @param {"create" | "update"} stamp
 * @param {unknown} context The call's context.
 */
function stampedAttributes(resource, attributes, stamp, context) {
  const kept = storedTimestamps(resource.schema);
  if (kept.length < 1 || (stamp === "update" && Object.keys(attributes).length < 1)) {
    return { ...attributes };
  }
  const callerSets = setsOwnTimestamps(context);
  const data = Object.fromEntries(Object.entries(attributes).filter(([field]) => callerSets || !kept.includes(field)));
  const now = new Date().toISOString();
  for (const field of storedTimestamps(resource.schema, stamp === "create" ? RECORD_TIMESTAMPS : ["updatedAt"])) {
    if (!Object.hasOwn(data, field)) {
      data[field] = now;
    }
  }
  return data;
}

/**
 * An upsert's onConflict with the timestamps its merge changes: updatedAt moves on, and a createdAt the handle stamped
 * is the new record's only, so a merge then names its fields (those the rows give, by their field names).
 * @param {{ schema: Record<string, any> }} resource
 * @param {Array<Record<string, unknown>>} rows The caller's rows, before stamping.
 * @param {{ action?: string, merge?: string[] }} onConflict
 * @param {unknown} context The call's context: only a caller that sets its own timestamps merges its createdAt.
 */
function upsertConflict(resource, rows, onConflict, context) {
  if (onConflict.action !== "merge") {
    return onConflict;
  }
  const updated = storedTimestamps(resource.schema, ["updatedAt"]);
  const callerSets = setsOwnTimestamps(context);
  const mergeOf = (fields, mergesCreated) => [...new Set([...fields, ...updated])]
    .filter((field) => field !== "id" && (mergesCreated || field !== "createdAt"));
  if (onConflict.merge !== undefined) {
    return { ...onConflict, merge: mergeOf(onConflict.merge, callerSets) };
  }
  const stampsCreated = storedTimestamps(resource.schema, ["createdAt"]).length > 0 &&
    (!callerSets || rows.some((row) => isRecord(row) && !Object.hasOwn(row, "createdAt")));
  if (!stampsCreated) {
    return onConflict;
  }
  const fieldOf = Object.fromEntries(Object.entries(resource.schema).map(([field, definition]) => [definition?.as || field, field]));
  return { ...onConflict, merge: mergeOf(rows.flatMap((row) => Object.keys(row)).map((key) => fieldOf[key] || key), false) };
}

/**
 * Record attributes as json-rest-api's input, stamped (see stampedAttributes): a belongs-to field written under its
 * key goes to its relationship.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} attributes
 * @param {"create" | "update"} stamp
 * @param {unknown} context The call's context.
 */
function inputData(resource, attributes, stamp, context) {
  if (!isRecord(attributes)) {
    throw new TypeError(`${resource.name} writes take attributes as an object.`);
  }
  const data = stampedAttributes(resource, attributes, stamp, context);
  for (const [fieldName, definition] of Object.entries(resource.schema)) {
    if (!definition?.belongsTo || !Object.hasOwn(data, fieldName)) {
      continue;
    }
    const relationshipName = definition.as || fieldName;
    if (relationshipName === fieldName) {
      continue;
    }
    if (Object.hasOwn(data, relationshipName)) {
      throw new TypeError(`Provide either "${fieldName}" or "${relationshipName}", not both.`);
    }
    if (data[fieldName] !== undefined) {
      data[relationshipName] = data[fieldName];
    }
    delete data[fieldName];
  }
  return data;
}

/**
 * The relationships a read includes: the first name of each `include` path.
 * @param {unknown} include
 */
function includedRelationships(include) {
  if (include === undefined) {
    return new Set();
  }
  return new Set(textList(include).flatMap((entry) => String(entry).split(",")).map((path) => path.trim().split(".")[0]));
}

/**
 * A json-rest-api plain record as a handle's record: each belongs-to field
 * carries the related id under its own name (null when unset), and the related
 * record stays nested under its relationship only when the read included it.
 * @param {{ schema: Record<string, any> }} resource
 * @param {unknown} record
 * @param {Set<string>} included
 */
function handleRecord(resource, record, included) {
  if (!isRecord(record)) {
    return record;
  }
  const shaped = { ...record };
  for (const [fieldName, definition] of Object.entries(resource.schema)) {
    if (!definition?.belongsTo) {
      continue;
    }
    const relationshipName = definition.as || fieldName;
    const related = record[relationshipName];
    if (relationshipName === fieldName && included.has(relationshipName)) {
      continue;
    }
    shaped[fieldName] = related?.id == null ? null : String(related.id);
    if (relationshipName !== fieldName && !included.has(relationshipName)) {
      delete shaped[relationshipName];
    }
  }
  return shaped;
}

/**
 * Plain records as a handle answers them.
 * @param {{ schema: Record<string, any> }} resource
 * @param {unknown[]} records
 * @param {unknown} [include]
 */
function handleRecords(resource, records, include) {
  const included = includedRelationships(include);
  return records.map((record) => handleRecord(resource, record, included));
}

/**
 * One single-record answer: a plain record as a handle answers it, or a
 * JSON:API document left as it is.
 * @param {{ schema: Record<string, any> }} resource
 * @param {unknown} result
 * @param {string} format
 * @param {unknown} [include]
 */
function handleResult(resource, result, format, include) {
  return format === "jsonapi" ? result : handleRecord(resource, result, includedRelationships(include));
}

// A single write's `returning`, as json-rest-api names it.
const SINGLE_RETURNING = Object.freeze({ record: "full", id: "minimal", none: "none" });
// A many-row write's `returning`, as json-rest-api names it.
const MANY_RETURNING = Object.freeze({ none: "none", ids: "minimal", records: "full", count: "count" });

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

// The answer of a many-row write: nothing, the ids, or the records.
function manyResult(resource, result, returning) {
  if (returning === "none") {
    return undefined;
  }
  const rows = result?.data || [];
  if (returning === "count") {
    return Number(result?.meta?.count ?? rows.length);
  }
  return returning === "ids" ? rows.map((row) => String(row.id)) : handleRecords(resource, rows);
}

// What patch() answers for the row it wrote or read: the record (default), its id, or nothing.
function patchAnswer(id, record, returning) {
  if (returning === "none") {
    return undefined;
  }
  return returning === "id" ? id : record;
}

// Whether the stored record still holds every value onlyIf names.
function matchesOnlyIf(record, onlyIf) {
  return Object.entries(onlyIf).every(([field, value]) => (record[field] ?? null) === value);
}

export {
  MANY_RETURNING,
  SINGLE_RETURNING,
  handleRecords,
  handleResult,
  idOf,
  inputData,
  manyResult,
  matchesOnlyIf,
  patchAnswer,
  upsertConflict,
  pickReturning,
  readQueryParams,
  textList
};
