import {
  normalizeDbRecordId,
  toDatabaseDateTimeUtc
} from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { RECORD_ID_PATTERN } from "@jskit-ai/kernel/shared/validators";
import { normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { resolveStructuredSchemaTransportSchema } from "@jskit-ai/kernel/shared/validators";
import {
  buildCrudFieldContractMap,
  CRUD_FIELD_STORAGE_COLUMN,
  CRUD_FIELD_STORAGE_VIRTUAL,
  CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC
} from "@jskit-ai/kernel/shared/support/crudFieldContract";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";
import {
  resolveCrudLookupContainerKey,
  resolveCrudLookupFieldKeys
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { isCrudRuntimeOutputOnlyFieldKey } from "../shared/crudFieldSupport.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const CRUD_WRITE_SERIALIZERS = Object.freeze({
  [CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC]: (value) => toDatabaseDateTimeUtc(value)
});

function normalizeCrudListCursor(cursor = null, { allowEmpty = true } = {}) {
  if (cursor === undefined || cursor === null) {
    return allowEmpty === true ? "" : null;
  }

  const normalizedCursor = typeof cursor === "string"
    ? cursor.trim()
    : cursor;
  if (normalizedCursor === "" || normalizedCursor === 0 || normalizedCursor === "0") {
    return allowEmpty === true ? "" : null;
  }

  const recordId = normalizeRecordId(normalizedCursor, { fallback: null });
  if (!recordId) {
    throw new AppError(400, "Invalid cursor.", {
      code: "INVALID_CURSOR"
    });
  }

  return recordId;
}

function normalizeCrudListLimit(value, { fallback = DEFAULT_LIST_LIMIT, max = MAX_LIST_LIMIT } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function requireCrudTableName(tableName, { context = "crudRepository" } = {}) {
  const normalizedTableName = normalizeText(tableName);
  if (!normalizedTableName) {
    throw new TypeError(`${context} requires tableName.`);
  }

  return normalizedTableName;
}

function resolveColumnName(fieldKey, overrides = {}) {
  const normalizedKey = String(fieldKey || "").trim();
  if (!normalizedKey) {
    return "";
  }

  const overrideValue = String(overrides?.[normalizedKey] || "").trim();
  if (overrideValue) {
    return overrideValue;
  }

  return toSnakeCase(normalizedKey);
}

function buildRepositoryColumnMetadata({
  outputKeys = [],
  writeKeys = [],
  columnOverrides = {},
  fieldStorageByKey = {}
} = {}) {
  const normalizedOutputKeys = (Array.isArray(outputKeys) ? outputKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);
  const normalizedWriteKeys = (Array.isArray(writeKeys) ? writeKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);

  const deriveMapping = (key) => {
    if (fieldStorageByKey?.[key] !== CRUD_FIELD_STORAGE_COLUMN) {
      return null;
    }
    const column = resolveColumnName(key, columnOverrides);
    if (!column) {
      return null;
    }
    return { key, column };
  };

  const outputMappings = normalizedOutputKeys.map(deriveMapping).filter(Boolean);
  const writeMappings = normalizedWriteKeys.map(deriveMapping).filter(Boolean);
  const selectColumns = Object.freeze(
    [...new Set(outputMappings.map((mapping) => mapping.column))]
  );

  return Object.freeze({
    selectColumns,
    outputMappings: Object.freeze(outputMappings),
    writeMappings: Object.freeze(writeMappings)
  });
}

function resolveOptionalObjectSchemaProperties(schema, options = {}) {
  if (!schema) {
    return {};
  }
  return requireObjectSchemaProperties(schema, options);
}

function requireObjectSchemaProperties(schema, { context = "crudRepository", schemaLabel = "schema" } = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TypeError(`${context} requires ${schemaLabel} to be an object schema.`);
  }

  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    throw new TypeError(`${context} requires ${schemaLabel}.properties.`);
  }

  return properties;
}

function schemaIncludesStringType(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  const type = normalizeText(schema.type).toLowerCase();
  if (type === "string") {
    return true;
  }

  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  return variants.some((entry) => schemaIncludesStringType(entry));
}

function schemaIncludesDateTimeFormat(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  const jsonRestSchemaMeta = schema["x-json-rest-schema"];
  const castType = normalizeText(jsonRestSchemaMeta?.castType).toLowerCase();
  if (castType === "datetime") {
    return true;
  }

  if (normalizeText(schema.format).toLowerCase() === "date-time") {
    return true;
  }

  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  return variants.some((entry) => schemaIncludesDateTimeFormat(entry));
}

function schemaIncludesRecordIdType(schema = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  const type = Array.isArray(schema.type)
    ? schema.type.map((entry) => normalizeText(entry).toLowerCase()).filter(Boolean)
    : normalizeText(schema.type).toLowerCase();
  const hasStringType = Array.isArray(type)
    ? type.includes("string")
    : type === "string";
  if (hasStringType && normalizeText(schema.pattern) === RECORD_ID_PATTERN) {
    return true;
  }

  const variants = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : [];
  return variants.some((entry) => schemaIncludesRecordIdType(entry));
}

function deriveRepositoryMappingFromResource(resource = {}, { context = "crudRepository" } = {}) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError(`${context} requires resource object.`);
  }

  const operations = resource.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
    throw new TypeError(`${context} requires resource.operations.`);
  }

  const outputSchema = resolveStructuredSchemaTransportSchema(operations?.view?.output, {
    context: `${context} operations.view.output`,
    defaultMode: "replace"
  });
  const writeSchema = resolveStructuredSchemaTransportSchema(operations?.create?.body, {
    context: `${context} operations.create.body`,
    defaultMode: "create"
  });
  const patchSchema = resolveStructuredSchemaTransportSchema(operations?.patch?.body, {
    context: `${context} operations.patch.body`,
    defaultMode: "patch"
  });
  const outputProperties = requireObjectSchemaProperties(outputSchema, {
    context,
    schemaLabel: "operations.view.output.schema"
  });
  const writeProperties = requireObjectSchemaProperties(writeSchema, {
    context,
    schemaLabel: "operations.create.body.schema"
  });
  const patchProperties = resolveOptionalObjectSchemaProperties(patchSchema, {
    context,
    schemaLabel: "operations.patch.body.schema"
  });
  const lookupContainerKey = resolveCrudLookupContainerKey(resource, {
    context: `${context} resource.contract.lookup.containerKey`
  });
  const outputKeys = Object.freeze(
    Object.keys(outputProperties).filter(
      (key) => !isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })
    )
  );
  const writeKeys = Object.freeze([
    ...Object.keys(writeProperties),
    ...Object.keys(patchProperties).filter((key) => !Object.hasOwn(writeProperties, key))
  ]);

  const fieldStorageByKey = {};
  const columnOverrides = {};
  const writeSerializerByKey = {};
  for (const entry of Object.values(buildCrudFieldContractMap(resource, {
    context: `${context} resource field contract`
  }))) {
    const key = normalizeText(entry.key);
    if (!key) {
      continue;
    }
    fieldStorageByKey[key] = entry?.storage?.mode || CRUD_FIELD_STORAGE_COLUMN;
    if (entry?.storage?.column) {
      columnOverrides[key] = entry.storage.column;
    }
    if (entry?.storage?.writeSerializer) {
      writeSerializerByKey[key] = entry.storage.writeSerializer;
    }
  }

  for (const key of [...outputKeys, ...writeKeys]) {
    if (!fieldStorageByKey[key]) {
      fieldStorageByKey[key] = CRUD_FIELD_STORAGE_COLUMN;
    }
  }

  const virtualOutputKeys = [];
  const columnBackedOutputKeys = [];
  for (const key of outputKeys) {
    const storage = fieldStorageByKey[key] || CRUD_FIELD_STORAGE_COLUMN;
    if (storage === CRUD_FIELD_STORAGE_VIRTUAL) {
      virtualOutputKeys.push(key);
      continue;
    }
    columnBackedOutputKeys.push(key);
  }

  for (const key of virtualOutputKeys) {
    if (Object.hasOwn(writeProperties, key)) {
      throw new Error(
        `${context} resource create schema field "${key}" cannot use storage.virtual.`
      );
    }
    if (Object.hasOwn(patchProperties, key)) {
      throw new Error(
        `${context} resource patch schema field "${key}" cannot use storage.virtual.`
      );
    }
  }

  const listSearchColumns = [];
  for (const [key, schema] of Object.entries(outputProperties)) {
    if ((fieldStorageByKey[key] || CRUD_FIELD_STORAGE_COLUMN) !== CRUD_FIELD_STORAGE_COLUMN) {
      continue;
    }
    if (!schemaIncludesStringType(schema)) {
      continue;
    }

    const columnName = resolveColumnName(key, columnOverrides);
    if (!columnName || listSearchColumns.includes(columnName)) {
      continue;
    }
    listSearchColumns.push(columnName);
  }

  const parentFilterColumns = {};
  for (const key of resolveCrudLookupFieldKeys(resource, { allowKeys: writeKeys })) {
    if ((fieldStorageByKey[key] || CRUD_FIELD_STORAGE_COLUMN) !== CRUD_FIELD_STORAGE_COLUMN) {
      continue;
    }
    const columnName = resolveColumnName(key, columnOverrides);
    if (!columnName) {
      continue;
    }
    parentFilterColumns[key] = columnName;
  }

  const outputRecordIdKeys = [];
  for (const [key, schema] of Object.entries(outputProperties)) {
    if (schemaIncludesRecordIdType(schema)) {
      outputRecordIdKeys.push(key);
    }
  }

  for (const key of writeKeys) {
    if ((fieldStorageByKey[key] || CRUD_FIELD_STORAGE_COLUMN) !== CRUD_FIELD_STORAGE_COLUMN) {
      continue;
    }

    if (writeSerializerByKey[key]) {
      continue;
    }

    const schema = writeProperties[key] || patchProperties[key];
    if (!schemaIncludesDateTimeFormat(schema)) {
      continue;
    }

    writeSerializerByKey[key] = CRUD_FIELD_WRITE_SERIALIZER_DATETIME_UTC;
  }

  return Object.freeze({
    outputKeys,
    writeKeys,
    writeSerializerByKey: Object.freeze(writeSerializerByKey),
    fieldStorageByKey: Object.freeze(fieldStorageByKey),
    columnOverrides: Object.freeze(columnOverrides),
    columnBackedOutputKeys: Object.freeze(columnBackedOutputKeys),
    virtualOutputKeys: Object.freeze(virtualOutputKeys),
    listSearchColumns: Object.freeze(listSearchColumns),
    parentFilterColumns: Object.freeze(parentFilterColumns),
    outputRecordIdKeys: Object.freeze(outputRecordIdKeys)
  });
}

function mapRecordRow(row, fieldKeys = [], overrides = {}, { recordIdKeys = [] } = {}) {
  if (!row) {
    return null;
  }

  const recordIdKeySet = new Set(
    (Array.isArray(recordIdKeys) ? recordIdKeys : [])
      .map((key) => String(key || "").trim())
      .filter(Boolean)
  );
  const mapped = {};
  for (const key of fieldKeys) {
    const normalizedKey = String(key || "").trim();
    const columnName = resolveColumnName(normalizedKey, overrides);
    if (!normalizedKey || !columnName) {
      continue;
    }

    const rawValue = row[columnName];
    if (recordIdKeySet.has(normalizedKey)) {
      const normalizedIdValue = normalizeDbRecordId(rawValue, { fallback: null });
      mapped[normalizedKey] = normalizedIdValue || rawValue;
      continue;
    }

    mapped[normalizedKey] = rawValue;
  }
  return mapped;
}

function applyCrudListQueryFilters(
  query,
  {
    idColumn = "id",
    cursor = "",
    applyCursor = true,
    q = "",
    searchColumns = [],
    parentFilters = {},
    parentFilterColumns = {}
  } = {}
) {
  if (!query || typeof query.modify !== "function" || typeof query.where !== "function") {
    throw new TypeError("applyCrudListQueryFilters requires query builder.");
  }

  const normalizedSearch = String(q || "").trim();
  const normalizedSearchColumns = (Array.isArray(searchColumns) ? searchColumns : [])
    .map((columnName) => String(columnName || "").trim())
    .filter(Boolean);

  let nextQuery = query;

  const sourceParentFilters = normalizeObjectInput(parentFilters);
  const normalizedParentFilterColumns = parentFilterColumns && typeof parentFilterColumns === "object" && !Array.isArray(parentFilterColumns)
    ? parentFilterColumns
    : {};

  for (const [fieldKey, columnNameRaw] of Object.entries(normalizedParentFilterColumns)) {
    if (!Object.hasOwn(sourceParentFilters, fieldKey)) {
      continue;
    }

    const columnName = String(columnNameRaw || "").trim();
    if (!columnName) {
      continue;
    }

    const sourceValue = sourceParentFilters[fieldKey];
    const normalizedValue = typeof sourceValue === "string"
      ? sourceValue.trim()
      : sourceValue;
    if (normalizedValue === "" || normalizedValue === undefined || normalizedValue === null) {
      continue;
    }

    nextQuery = nextQuery.where(columnName, normalizedValue);
  }

  if (normalizedSearch && normalizedSearchColumns.length > 0) {
    const searchPattern = `%${normalizedSearch}%`;
    nextQuery = nextQuery.modify((searchQuery) => {
      searchQuery.where((whereQuery) => {
        for (const [index, columnName] of normalizedSearchColumns.entries()) {
          if (index === 0) {
            whereQuery.where(columnName, "like", searchPattern);
            continue;
          }
          whereQuery.orWhere(columnName, "like", searchPattern);
        }
      });
    });
  }

  const normalizedIdColumn = String(idColumn || "").trim() || "id";
  if (applyCursor !== false) {
    const normalizedCursor = normalizeCrudListCursor(cursor);
    if (normalizedCursor) {
      nextQuery = nextQuery.where(normalizedIdColumn, ">", normalizedCursor);
    }
  }

  return nextQuery;
}

function buildWritePayload(sourcePayload = {}, fieldKeys = [], overrides = {}, { serializerByKey = {} } = {}) {
  const source = normalizeObjectInput(sourcePayload);
  const normalizedSerializerByKey = serializerByKey && typeof serializerByKey === "object" && !Array.isArray(serializerByKey)
    ? serializerByKey
    : {};
  const payload = {};
  for (const key of fieldKeys) {
    const normalizedKey = String(key || "").trim();
    const columnName = resolveColumnName(normalizedKey, overrides);
    if (!normalizedKey || !columnName) {
      continue;
    }
    if (!Object.hasOwn(source, normalizedKey)) {
      continue;
    }
    const value = source[normalizedKey];
    const serializerId = normalizeText(normalizedSerializerByKey[normalizedKey]).toLowerCase();
    if (value === null || value === undefined || !serializerId) {
      payload[columnName] = value;
      continue;
    }

    const serializer = CRUD_WRITE_SERIALIZERS[serializerId];
    if (typeof serializer !== "function") {
      throw new Error(`crudRepository write serializer "${serializerId}" is not supported.`);
    }

    payload[columnName] = serializer(value);
  }
  return payload;
}

function resolveCrudIdColumn(idColumn, { fallback = "id" } = {}) {
  const normalized = String(idColumn ?? fallback ?? "").trim();
  if (!normalized) {
    throw new TypeError("crudRepository requires idColumn.");
  }
  return normalized;
}

export {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  normalizeCrudListLimit,
  normalizeCrudListCursor,
  requireCrudTableName,
  deriveRepositoryMappingFromResource,
  applyCrudListQueryFilters,
  mapRecordRow,
  buildWritePayload,
  resolveColumnName,
  resolveCrudIdColumn,
  buildRepositoryColumnMetadata
};
