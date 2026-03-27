import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators/inputNormalization";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

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
  requireCrudTableName,
  mapRecordRow,
  buildWritePayload,
  resolveColumnName,
  resolveCrudIdColumn,
  buildRepositoryColumnMetadata
};
