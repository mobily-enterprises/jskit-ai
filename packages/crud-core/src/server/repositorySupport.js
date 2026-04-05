import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";
import {
  resolveCrudLookupContainerKey,
  resolveCrudLookupFieldKeys
} from "@jskit-ai/kernel/shared/support/crudLookup";
import { isCrudRuntimeOutputOnlyFieldKey } from "../shared/crudFieldMetaSupport.js";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function normalizeCrudListCursor(cursor = null, { allowEmpty = true } = {}) {
  if (cursor === undefined || cursor === null) {
    return allowEmpty === true ? 0 : null;
  }

  const normalizedCursor = typeof cursor === "string"
    ? cursor.trim()
    : cursor;
  if (normalizedCursor === "" || normalizedCursor === 0 || normalizedCursor === "0") {
    return allowEmpty === true ? 0 : null;
  }

  const numericCursor = Number(normalizedCursor);
  if (!Number.isInteger(numericCursor) || numericCursor < 1) {
    throw new AppError(400, "Invalid cursor.", {
      code: "INVALID_CURSOR"
    });
  }

  return numericCursor;
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
  columnOverrides = {}
} = {}) {
  const normalizedOutputKeys = (Array.isArray(outputKeys) ? outputKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);
  const normalizedWriteKeys = (Array.isArray(writeKeys) ? writeKeys : [])
    .map((key) => String(key || "").trim())
    .filter(Boolean);

  const deriveMapping = (key) => {
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

function normalizeResourceFieldMetaEntries(fieldMeta = []) {
  if (!Array.isArray(fieldMeta)) {
    return [];
  }

  const normalized = [];
  const seenKeys = new Set();
  for (const rawEntry of fieldMeta) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const key = normalizeText(rawEntry.key);
    if (!key || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);
    normalized.push(rawEntry);
  }

  return normalized;
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

function deriveRepositoryMappingFromResource(resource = {}, { context = "crudRepository" } = {}) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw new TypeError(`${context} requires resource object.`);
  }

  const operations = resource.operations;
  if (!operations || typeof operations !== "object" || Array.isArray(operations)) {
    throw new TypeError(`${context} requires resource.operations.`);
  }

  const outputSchema = operations?.view?.outputValidator?.schema;
  const writeSchema = operations?.create?.bodyValidator?.schema;
  const outputProperties = requireObjectSchemaProperties(outputSchema, {
    context,
    schemaLabel: "operations.view.outputValidator.schema"
  });
  const writeProperties = requireObjectSchemaProperties(writeSchema, {
    context,
    schemaLabel: "operations.create.bodyValidator.schema"
  });
  const lookupContainerKey = resolveCrudLookupContainerKey(resource, {
    context: `${context} resource.contract.lookup.containerKey`
  });
  const outputKeys = Object.freeze(
    Object.keys(outputProperties).filter(
      (key) => !isCrudRuntimeOutputOnlyFieldKey(key, { lookupContainerKey })
    )
  );
  const writeKeys = Object.freeze(Object.keys(writeProperties));

  const columnOverrides = {};
  for (const entry of normalizeResourceFieldMetaEntries(resource.fieldMeta)) {
    const key = normalizeText(entry.key);
    const dbColumn = normalizeText(entry.dbColumn);
    if (!key || !dbColumn) {
      continue;
    }
    columnOverrides[key] = dbColumn;
  }

  const listSearchColumns = [];
  for (const [key, schema] of Object.entries(outputProperties)) {
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
    const columnName = resolveColumnName(key, columnOverrides);
    if (!columnName) {
      continue;
    }
    parentFilterColumns[key] = columnName;
  }

  return Object.freeze({
    outputKeys,
    writeKeys,
    columnOverrides: Object.freeze(columnOverrides),
    listSearchColumns: Object.freeze(listSearchColumns),
    parentFilterColumns: Object.freeze(parentFilterColumns)
  });
}

function mapRecordRow(row, fieldKeys = [], overrides = {}) {
  if (!row) {
    return null;
  }

  const mapped = {};
  for (const key of fieldKeys) {
    const normalizedKey = String(key || "").trim();
    const columnName = resolveColumnName(normalizedKey, overrides);
    if (!normalizedKey || !columnName) {
      continue;
    }
    mapped[normalizedKey] = row[columnName];
  }
  return mapped;
}

function applyCrudListQueryFilters(
  query,
  {
    idColumn = "id",
    cursor = 0,
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
    if (normalizedCursor > 0) {
      nextQuery = nextQuery.where(normalizedIdColumn, ">", normalizedCursor);
    }
  }

  return nextQuery;
}

function buildWritePayload(sourcePayload = {}, fieldKeys = [], overrides = {}) {
  const source = normalizeObjectInput(sourcePayload);
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
    payload[columnName] = source[normalizedKey];
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
