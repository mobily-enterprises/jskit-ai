import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
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
 * Record attributes as json-rest-api's input: a belongs-to field written under
 * its key goes to its relationship.
 * @param {{ name: string, schema: Record<string, any> }} resource
 * @param {unknown} attributes
 */
function inputData(resource, attributes) {
  if (!isRecord(attributes)) {
    throw new TypeError(`${resource.name} writes take attributes as an object.`);
  }
  const data = { ...attributes };
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

export { handleRecords, handleResult, idOf, inputData, readQueryParams, textList };
