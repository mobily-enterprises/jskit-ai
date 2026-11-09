import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { RECORD_TIMESTAMPS, storedTimestamps } from "@jskit-ai/resource-core/shared/tableResource";
import { isJobContext } from "./contexts.js";
import { blobBuffers } from "./handleBlobs.js";
import { requireDefinedFilters } from "./handleGuards.js";
import { resolveJsonRestCollectionRelationships } from "./jsonRestValues.js";

// What a handle takes and answers, in json-rest-api's terms: read parameters,
// write input with belongs-to fields under their relationships, and plain
// records with each belongs-to field as the related id.

const READ_PARAM_KEYS = Object.freeze(["filters", "sort", "include", "fields", "page"]);

/** @param {unknown} value */
function textList(value) {
  return Array.isArray(value) ? value : [value];
}

/**
 * A sparse fieldset as json-rest-api takes it: a list of the resource's own fields, or `{ [type]: "a,b" }`. json-rest-api
 * names a belongs-to field by its relationship (`as`), while a handle's records answer it under the field's own key,
 * so the resource's own fields may be named either way; the field's key would otherwise select no relationship and
 * answer null.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {string[] | Record<string, string>} fields
 */
function sparseFieldset(resource, fields) {
  const own = (names) => [...new Set(names.map((field) => {
    const definition = resource.schema[field];
    return definition?.belongsTo && definition.as ? definition.as : field;
  }))].join(",");
  if (Array.isArray(fields)) {
    return { [resource.name]: own(fields) };
  }
  if (!isRecord(fields) || typeof fields[resource.name] !== "string") {
    return fields;
  }
  return { ...fields, [resource.name]: own(fields[resource.name].split(",").map((field) => field.trim()).filter(Boolean)) };
}

/**
 * The collection relations a kind of read loads only when it includes them: those whose `hydrateOnList` (lists) or
 * `hydrateOnView` (one record) is false.
 * @param {{ schema: Record<string, any> }} resource
 * @param {"hydrateOnList" | "hydrateOnView"} flag
 */
function quietCollections(resource, flag) {
  return Object.entries(resource.schema).flatMap(([fieldName, definition]) => {
    const relation = definition?.relation;
    return relation?.kind === "collection" && relation[flag] === false
      ? [{ fieldName, relationshipName: relation.as || definition.as || fieldName }]
      : [];
  });
}

/**
 * The fields a read names: the caller's own, or, when it names none and leaves out one of its quiet collections (see
 * quietCollections), every field json-rest-api would answer but those, so their rows are not read.
 * @param {{ fields?: unknown, include?: unknown }} params
 * @param {Array<{ fieldName: string, relationshipName: string }>} quiet
 * @param {() => { outputFields: Record<string, any>, outputRelationships: Record<string, any>, idProperty?: string }} schemaInfo
 *   json-rest-api's compiled schema of the resource.
 */
function requestedFields(params, quiet, schemaInfo) {
  const included = includedRelationships(params.include);
  const skipped = quiet.filter(({ relationshipName }) => !included.has(relationshipName));
  if (params.fields !== undefined || skipped.length < 1) {
    return params.fields;
  }
  const left = new Set(skipped.flatMap(({ fieldName, relationshipName }) => [fieldName, relationshipName]));
  return defaultFieldList(schemaInfo()).filter((field) => !left.has(field));
}

/**
 * Every field a read that names none answers, as a list a read can name: the attributes json-rest-api answers by
 * default (none hidden, none normally hidden, blobs among those) and every relationship.
 * @param {{ outputFields: Record<string, any>, outputRelationships: Record<string, any>, idProperty?: string }} schemaInfo
 *   json-rest-api's compiled schema of the resource.
 * @returns {string[]}
 */
function defaultFieldList({ outputFields, outputRelationships, idProperty }) {
  return [
    ...Object.entries(outputFields)
      .filter(([field, definition]) => field !== "id" && field !== idProperty && !definition?.hidden && !definition?.normallyHidden)
      .map(([field]) => field),
    ...Object.keys(outputRelationships)
  ];
}

/**
 * An aggregate's measures as json-rest-api takes them. A record's id is no schema field there, so a count of it, or
 * of its distinct values, which are every row's, is the count of rows (`"*"`).
 * @param {unknown} measures
 */
function aggregateMeasures(measures) {
  if (!isRecord(measures)) {
    return measures;
  }
  return Object.fromEntries(Object.entries(measures).map(([measureName, spec]) => {
    if (!isRecord(spec) || (spec.count !== "id" && spec.countDistinct !== "id")) {
      return [measureName, spec];
    }
    const { count: _count, countDistinct: _countDistinct, ...rest } = spec;
    return [measureName, { ...rest, count: "*" }];
  }));
}

/**
 * What aggregate() answers over no rows: no groups, or, without groupBy, one row of totals (each count 0, every other
 * measure null), as json-rest-api answers it.
 * @param {Record<string, Record<string, unknown>>} measures
 * @param {unknown[] | undefined} groupBy
 */
function noRowsAggregate(measures, groupBy) {
  if (Array.isArray(groupBy) && groupBy.length > 0) {
    return Object.freeze([]);
  }
  const totals = Object.entries(measures || {}).map(([measureName, spec]) => [
    measureName,
    isRecord(spec) && (Object.hasOwn(spec, "count") || Object.hasOwn(spec, "countDistinct")) ? 0 : null
  ]);
  return Object.freeze([Object.freeze(Object.fromEntries(totals))]);
}

/**
 * What aggregate() answers: every group's rows without `page`, and with it the page's groups and the page, as query()
 * answers a page, so a caller never takes one page of groups for every group.
 * @param {readonly Record<string, unknown>[]} rows
 * @param {{ size: number, number?: number } | undefined} page
 * @param {boolean} hasMore
 */
function aggregateAnswer(rows, page, hasMore) {
  if (page === undefined) {
    return rows;
  }
  const number = page.number ?? 1;
  return Object.freeze({
    rows,
    page: Object.freeze({ size: Number(page.size), number, hasMore, next: hasMore ? number + 1 : null })
  });
}

/**
 * The read parameters of a handle call as json-rest-api's queryParams.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {Record<string, any>} params
 * @param {{ page: boolean, caller: string }} allowed
 */
function readQueryParams(resource, params, { page, caller }) {
  const { name } = resource;
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
    queryParams.fields = sparseFieldset(resource, params.fields);
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
 * Whether a write may set its own timestamps: only in a system context, or one it derived (an import, a migration, a
 * seed). Every other call is a request's, a call without a context too, so its timestamps are the handle's.
 * @param {unknown} context
 */
function setsOwnTimestamps(context) {
  return isJobContext(context);
}

// A date-time's text around its fraction of a second: what comes before, the digits, and the zone after them.
const SECOND_FRACTION = /^(.+T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/u;

/**
 * A timestamp as the field stores it: its fraction of a second cut (never rounded) to the field's temporalPrecision,
 * none for 0, the precision every write of the field is validated against. The handle's own stamps come from
 * `Date#toISOString()`, with milliseconds, and so do many a job's own (setsOwnTimestamps). Anything else, a date-time
 * with no fraction or a value that is no date-time, is left as it is, for validation to judge.
 * @param {{ temporalPrecision?: number }} field The field's schema definition.
 * @param {unknown} value
 */
function atPrecision(field, value) {
  const precision = field.temporalPrecision;
  const parts = typeof value === "string" && precision !== undefined ? SECOND_FRACTION.exec(value) : null;
  if (!parts || parts[2].length <= precision) {
    return value;
  }
  return `${parts[1]}${precision === 0 ? "" : `.${parts[2].slice(0, precision)}`}${parts[3]}`;
}

/**
 * A write's attributes with the table's timestamps (see storedTimestamps). The handle's stamps replace any the
 * caller sends, unless it may set its own (setsOwnTimestamps), so a request never sets them; a caller's own are cut to
 * the field's precision as the handle's are (atPrecision). A create stamps
 * createdAt and updatedAt, a change of a record updatedAt, and an empty change nothing, except on a table with a lock
 * version: there an empty change advances the version, which is an update like any other, so it stamps updatedAt and
 * the two never disagree about whether the record changed.
 * @param {{ schema: Record<string, any>, lockVersionField?: string }} resource
 * @param {Record<string, unknown>} attributes
 * @param {"create" | "update"} stamp
 * @param {unknown} context The call's context.
 */
function stampedAttributes(resource, attributes, stamp, context) {
  const kept = storedTimestamps(resource.schema);
  if (kept.length < 1 || (stamp === "update" && Object.keys(attributes).length < 1 && !resource.lockVersionField)) {
    return { ...attributes };
  }
  const callerSets = setsOwnTimestamps(context);
  const data = Object.fromEntries(Object.entries(attributes)
    .filter(([field]) => callerSets || !kept.includes(field))
    .map(([field, value]) => [field, kept.includes(field) ? atPrecision(resource.schema[field], value) : value]));
  const now = new Date().toISOString();
  for (const field of storedTimestamps(resource.schema, stamp === "create" ? RECORD_TIMESTAMPS : ["updatedAt"])) {
    if (!Object.hasOwn(data, field)) {
      data[field] = atPrecision(resource.schema[field], now);
    }
  }
  return data;
}

/**
 * An upsert's onConflict with the timestamps its merge changes: updatedAt moves on, and a createdAt the handle stamped
 * is the new record's only, so a merge then names its fields (those the rows give, by their field names), less those
 * a merge never changes: the conflict keys, the ownership fields and the lock version.
 * @param {{ schema: Record<string, any>, lockVersionField?: string }} resource
 * @param {Array<Record<string, unknown>>} rows The caller's rows, before stamping.
 * @param {{ action?: string, keys?: string[], merge?: string[] }} onConflict
 * @param {unknown} context The call's context: only a caller that sets its own timestamps merges its createdAt.
 * @param {string[]} ownershipFields The table's ownership fields, json-rest-api's `schemaInfo.ownershipFields`.
 */
function upsertConflict(resource, rows, onConflict, context, ownershipFields) {
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
  const kept = new Set([...(onConflict.keys ?? []), ...ownershipFields, resource.lockVersionField].filter(Boolean));
  const merge = mergeOf(rows.flatMap((row) => Object.keys(row)).map((key) => fieldOf[key] || key), false);
  return { ...onConflict, merge: merge.filter((field) => !kept.has(field)) };
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
  const data = blobBuffers(resource, stampedAttributes(resource, attributes, stamp, context));
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
 * The relationships a read includes, each with the include paths below it: `"pet.contact,vet"` includes pet, with
 * `["contact"]` below it, and vet.
 * @param {unknown} include
 * @returns {Map<string, string[]>}
 */
function includedRelationships(include) {
  const included = new Map();
  if (include === undefined) {
    return included;
  }
  for (const path of textList(include).flatMap((entry) => String(entry).split(",")).map((entry) => entry.trim()).filter(Boolean)) {
    const [head, ...rest] = path.split(".");
    included.set(head, [...(included.get(head) ?? []), ...(rest.length > 0 ? [rest.join(".")] : [])]);
  }
  return included;
}

/**
 * The resource's own fields a sparse read names (by relationship for a belongs-to field), or null when it reads all.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} fields
 */
function namedFields(resource, fields) {
  const own = fields === undefined ? undefined : sparseFieldset(resource, fields)?.[resource.name];
  return typeof own === "string" ? new Set(own.split(",")) : null;
}

/**
 * A json-rest-api plain record as a handle's record: each belongs-to field
 * carries the related id under its own name (null when unset), and the related
 * record stays nested under its relationship only when the read included it.
 * A sparse read leaves out a belongs-to field it did not name, so an unread
 * relation is never answered as null. An included record, or each record of an
 * included collection, is shaped the same way by its own resource, so it reads
 * as a read of that resource would answer it.
 * @param {{ schema: Record<string, any> }} resource
 * @param {unknown} record
 * @param {Map<string, string[]>} included
 * @param {Set<string> | null} named
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} [resourceNamed] The application's table
 *   resources by name, which shape included records; a read that includes passes it.
 */
function handleRecord(resource, record, included, named, resourceNamed) {
  if (!isRecord(record)) {
    return record;
  }
  const shaped = { ...record };
  // Included records keep their place, shaped by their own resource. json-rest-api reads a collection's linkage for
  // the records a read asks for, not for those it includes, so an included record leaves out a collection it does
  // not include itself rather than answer it as empty.
  const nested = (type, value, belowPaths) => {
    const related = resourceNamed(type);
    const below = includedRelationships(belowPaths);
    const shape = (entry) => {
      if (!related || !isRecord(entry)) {
        return entry;
      }
      const shapedEntry = handleRecord(related, entry, below, null, resourceNamed);
      for (const name of Object.keys(resolveJsonRestCollectionRelationships(related)).filter((key) => !below.has(key))) {
        delete shapedEntry[name];
      }
      return shapedEntry;
    };
    return Array.isArray(value) ? value.map(shape) : shape(value);
  };
  for (const [relationshipName, { target }] of Object.entries(resolveJsonRestCollectionRelationships(resource))) {
    if (included.has(relationshipName) && Object.hasOwn(record, relationshipName)) {
      shaped[relationshipName] = nested(target, record[relationshipName], included.get(relationshipName));
    }
  }
  for (const [fieldName, definition] of Object.entries(resource.schema)) {
    if (!definition?.belongsTo) {
      continue;
    }
    const relationshipName = definition.as || fieldName;
    if (named && !named.has(relationshipName) && !included.has(relationshipName)) {
      delete shaped[fieldName];
      delete shaped[relationshipName];
      continue;
    }
    const related = record[relationshipName];
    if (included.has(relationshipName)) {
      shaped[relationshipName] = nested(definition.belongsTo, related, included.get(relationshipName));
    }
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
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown[]} records
 * @param {{ include?: unknown, fields?: unknown }} [read] What the read included and the fields it named.
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} [resourceNamed] Shapes included records.
 */
function handleRecords(resource, records, { include, fields } = {}, resourceNamed) {
  const included = includedRelationships(include);
  const named = namedFields(resource, fields);
  return records.map((record) => handleRecord(resource, record, included, named, resourceNamed));
}

/**
 * One single-record answer: a plain record as a handle answers it, or a
 * JSON:API document left as it is.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} result
 * @param {string} format
 * @param {{ include?: unknown, fields?: unknown }} [read] What the read included and the fields it named.
 * @param {(name: string) => ({ name: string, schema: Record<string, any> } | null)} [resourceNamed] Shapes included records.
 */
function handleResult(resource, result, format, { include, fields } = {}, resourceNamed) {
  return format === "jsonapi"
    ? result
    : handleRecord(resource, result, includedRelationships(include), namedFields(resource, fields), resourceNamed);
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

export {
  aggregateMeasures,
  defaultFieldList,
  includedRelationships,
  MANY_RETURNING,
  SINGLE_RETURNING,
  handleRecords,
  handleResult,
  idOf,
  inputData,
  manyResult,
  namedFields,
  noRowsAggregate,
  aggregateAnswer,
  patchAnswer,
  upsertConflict,
  pickReturning,
  quietCollections,
  readQueryParams,
  requestedFields,
  sparseFieldset,
  textList
};
