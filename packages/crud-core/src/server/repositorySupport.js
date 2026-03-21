import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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

export {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  normalizeCrudListLimit,
  requireCrudTableName
};
