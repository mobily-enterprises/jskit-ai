import {
  normalizeCountRow,
  normalizeIdList as normalizeIdListBase,
  normalizeNullableString,
  parseJsonObject,
  stringifyJsonObject
} from "@jskit-ai/jskit-knex";
import { normalizeNullablePositiveInteger, parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizePagination as normalizePaginationBase } from "@jskit-ai/server-runtime-core/pagination";

function normalizePagination(pagination = {}, { defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const { page, pageSize } = normalizePaginationBase(pagination, {
    defaultPage: 1,
    defaultPageSize,
    maxPageSize
  });
  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
}

function resolveClient(dbClient, options = {}) {
  const trx = options && typeof options === "object" ? options.trx || null : null;
  return trx || dbClient;
}

function normalizeIdList(values) {
  return normalizeIdListBase(values, { parseValue: parsePositiveInteger });
}

function normalizeNullableDate(value) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function normalizeClientKey(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

export {
  normalizeClientKey,
  normalizeCountRow,
  normalizeIdList,
  normalizeNullableDate,
  normalizeNullablePositiveInteger,
  normalizeNullableString,
  normalizePagination,
  parseJsonObject,
  resolveClient,
  stringifyJsonObject
};
