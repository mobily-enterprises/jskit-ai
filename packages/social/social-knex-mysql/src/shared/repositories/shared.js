import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";

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

function resolveClient(dbClient, options = {}) {
  const trx = options && typeof options === "object" ? options.trx || null : null;
  return trx || dbClient;
}

function normalizeCountRow(row) {
  const values = Object.values(row || {});
  if (values.length < 1) {
    return 0;
  }

  const parsed = Number(values[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeNullablePositiveInteger(value) {
  return parsePositiveInteger(value);
}

function normalizeIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values.map((value) => parsePositiveInteger(value)).filter(Boolean)));
}

export {
  parseJsonObject,
  stringifyJsonObject,
  resolveClient,
  normalizeCountRow,
  normalizeNullableString,
  normalizeNullablePositiveInteger,
  normalizeIdList
};
