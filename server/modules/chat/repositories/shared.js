import { parsePositiveInteger } from "../../../lib/primitives/integers.js";

function parseJsonObject(value) {
  const source = String(value || "").trim();
  if (!source) {
    return {};
  }

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "{}";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function normalizeCountRow(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePagination(pagination = {}, { defaultPageSize = 20, maxPageSize = 100 } = {}) {
  const page = Math.max(1, parsePositiveInteger(pagination.page) || 1);
  const pageSize = Math.max(1, Math.min(maxPageSize, parsePositiveInteger(pagination.pageSize) || defaultPageSize));
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
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values.map((value) => parsePositiveInteger(value)).filter(Boolean)));
}

function normalizeNullableString(value, { trim = true } = {}) {
  if (value == null) {
    return null;
  }

  const source = String(value);
  const normalized = trim ? source.trim() : source;
  return normalized || null;
}

function normalizeNullablePositiveInteger(value) {
  return parsePositiveInteger(value);
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
