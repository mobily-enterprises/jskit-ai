import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveSchemaTransportSchemaDefinition } from "@jskit-ai/kernel/shared/validators";

const JSON_API_QUERY_PAGE_CURSOR_KEY = "page[cursor]";
const JSON_API_QUERY_PAGE_LIMIT_KEY = "page[limit]";
const JSON_API_QUERY_INCLUDE_KEY = "include";
const JSON_API_QUERY_SORT_KEY = "sort";
const JSON_API_FILTER_PREFIX = "filter[";
const JSON_API_FIELDS_PREFIX = "fields[";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeQueryKey(key = "") {
  return String(key || "").trim();
}

function buildFieldsTransportKey(responseType = "") {
  const normalizedResponseType = normalizeText(responseType);
  return normalizedResponseType ? `${JSON_API_FIELDS_PREFIX}${normalizedResponseType}]` : "";
}

function mapPlainQueryKeyToTransportKey(key = "", { responseType = "" } = {}) {
  const normalizedKey = normalizeQueryKey(key);
  if (!normalizedKey) {
    return "";
  }

  if (normalizedKey === "cursor") {
    return JSON_API_QUERY_PAGE_CURSOR_KEY;
  }
  if (normalizedKey === "limit") {
    return JSON_API_QUERY_PAGE_LIMIT_KEY;
  }
  if (normalizedKey === "q") {
    return `${JSON_API_FILTER_PREFIX}q]`;
  }
  if (normalizedKey === "include") {
    return JSON_API_QUERY_INCLUDE_KEY;
  }
  if (normalizedKey === "sort") {
    return JSON_API_QUERY_SORT_KEY;
  }
  if (normalizedKey === "fields") {
    return buildFieldsTransportKey(responseType);
  }

  return `${JSON_API_FILTER_PREFIX}${normalizedKey}]`;
}

function mapTransportQueryKeyToPlainKey(key = "", { responseType = "" } = {}) {
  const normalizedKey = normalizeQueryKey(key);
  if (!normalizedKey) {
    return "";
  }

  if (normalizedKey === JSON_API_QUERY_PAGE_CURSOR_KEY) {
    return "cursor";
  }
  if (normalizedKey === JSON_API_QUERY_PAGE_LIMIT_KEY) {
    return "limit";
  }
  if (normalizedKey === JSON_API_QUERY_INCLUDE_KEY) {
    return "include";
  }
  if (normalizedKey === JSON_API_QUERY_SORT_KEY) {
    return "sort";
  }
  if (normalizedKey === `${JSON_API_FILTER_PREFIX}q]`) {
    return "q";
  }

  const fieldsTransportKey = buildFieldsTransportKey(responseType);
  if (fieldsTransportKey && normalizedKey === fieldsTransportKey) {
    return "fields";
  }

  if (normalizedKey.startsWith(JSON_API_FILTER_PREFIX) && normalizedKey.endsWith("]")) {
    return normalizedKey.slice(JSON_API_FILTER_PREFIX.length, -1);
  }

  if (normalizedKey.startsWith(JSON_API_FIELDS_PREFIX) && normalizedKey.endsWith("]")) {
    return "fields";
  }

  return normalizedKey;
}

function normalizeTransportQueryScalar(value) {
  if (Array.isArray(value)) {
    const normalizedValues = value
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    if (normalizedValues.length < 1) {
      return "";
    }
    return normalizedValues.join(",");
  }

  return String(value ?? "").trim();
}

function encodeJsonApiResourceQueryObject(query = {}, { responseType = "" } = {}) {
  if (!isRecord(query)) {
    return Object.freeze({});
  }

  const source = normalizeObject(query);
  const encoded = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const transportKey = mapPlainQueryKeyToTransportKey(rawKey, {
      responseType
    });
    if (!transportKey) {
      continue;
    }

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const normalizedValues = values
      .map((entry) => String(entry ?? "").trim())
      .filter(Boolean);
    if (normalizedValues.length < 1) {
      continue;
    }

    encoded[transportKey] = normalizedValues.length === 1 ? normalizedValues[0] : normalizedValues;
  }

  return Object.freeze(encoded);
}

function decodeJsonApiResourceQueryObject(query = {}, { responseType = "" } = {}) {
  if (!isRecord(query)) {
    return Object.freeze({});
  }

  const source = normalizeObject(query);
  const decoded = {};

  for (const [rawKey, rawValue] of Object.entries(source)) {
    const plainKey = mapTransportQueryKeyToPlainKey(rawKey, {
      responseType
    });
    if (!plainKey) {
      continue;
    }

    const normalizedValue = normalizeTransportQueryScalar(rawValue);
    if (!normalizedValue) {
      continue;
    }

    decoded[plainKey] = normalizedValue;
  }

  return Object.freeze(decoded);
}

function createJsonApiResourceQueryTransportSchema({
  query,
  responseType = ""
} = {}) {
  const transportSchema = resolveSchemaTransportSchemaDefinition(query, {
    context: "JSON:API resource query",
    defaultMode: "patch"
  });

  if (!transportSchema || typeof transportSchema !== "object" || Array.isArray(transportSchema)) {
    throw new TypeError("JSON:API resource query transport schema must resolve to an object schema.");
  }

  const sourceSchema = normalizeObject(transportSchema);
  const sourceProperties = normalizeObject(sourceSchema.properties);
  const properties = {};

  for (const [plainKey, propertySchema] of Object.entries(sourceProperties)) {
    const transportKey = mapPlainQueryKeyToTransportKey(plainKey, {
      responseType
    });
    if (!transportKey) {
      continue;
    }
    properties[transportKey] = propertySchema;
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    properties
  };

  if (isRecord(sourceSchema.definitions) && Object.keys(sourceSchema.definitions).length > 0) {
    schema.definitions = normalizeObject(sourceSchema.definitions);
  }

  return schema;
}

export {
  JSON_API_QUERY_PAGE_CURSOR_KEY,
  JSON_API_QUERY_PAGE_LIMIT_KEY,
  JSON_API_QUERY_INCLUDE_KEY,
  JSON_API_QUERY_SORT_KEY,
  mapPlainQueryKeyToTransportKey,
  mapTransportQueryKeyToPlainKey,
  encodeJsonApiResourceQueryObject,
  decodeJsonApiResourceQueryObject,
  createJsonApiResourceQueryTransportSchema
};
