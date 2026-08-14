import {
  normalizeInteger,
  normalizeText,
  normalizeUniqueTextList
} from "@jskit-ai/kernel/shared/support/normalize";
import { asPlainObject } from "./scopeHelpers.js";

const DEFAULT_LIST_SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_LIST_SEARCH_MIN_LENGTH = 1;
const LIST_SEARCH_MODE_LOCAL = "local";
const LIST_SEARCH_MODE_QUERY = "query";

function normalizeListSearchConfig(value = {}) {
  const source = asPlainObject(value);
  const modeRaw = normalizeText(source.mode).toLowerCase();
  const mode = modeRaw === LIST_SEARCH_MODE_LOCAL
    ? LIST_SEARCH_MODE_LOCAL
    : LIST_SEARCH_MODE_QUERY;

  return Object.freeze({
    enabled: source.enabled === true,
    mode,
    queryParam: normalizeText(source.queryParam) || "q",
    label: normalizeText(source.label) || "Search",
    placeholder: normalizeText(source.placeholder),
    initialQuery: normalizeText(source.initialQuery),
    debounceMs: normalizeInteger(source.debounceMs, {
      fallback: DEFAULT_LIST_SEARCH_DEBOUNCE_MS,
      min: 0
    }),
    minLength: normalizeInteger(source.minLength, {
      fallback: DEFAULT_LIST_SEARCH_MIN_LENGTH,
      min: DEFAULT_LIST_SEARCH_MIN_LENGTH
    }),
    fields: Object.freeze(normalizeUniqueTextList(source.fields))
  });
}

function normalizeSearchableValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeText(value).toLowerCase();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).toLowerCase();
  }
  return "";
}

function matchesLocalSearch(item = {}, query = "", searchFields = []) {
  const source = asPlainObject(item);
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const fields = Array.isArray(searchFields) ? searchFields : [];
  if (fields.length > 0) {
    return fields.some((field) => normalizeSearchableValue(source[field]).includes(normalizedQuery));
  }

  return Object.values(source).some((value) => normalizeSearchableValue(value).includes(normalizedQuery));
}

export {
  normalizeListSearchConfig,
  matchesLocalSearch
};
